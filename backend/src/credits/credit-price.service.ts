import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER, type Cache } from '@nestjs/cache-manager';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 限时免费活动的运行时解析。
 *
 * 能力售价的唯一事实源是 `CapabilityPricing`；本服务**不再读取或覆盖**
 * `SystemSetting['creditPrice.*']`。它只负责回答一个与售价正交的问题：
 * 「这项能力此刻是否命中限时免费活动」。
 *
 * 缓存 3 秒：活动到点后最多 3 秒恢复原价，不需要补偿任务把价格改回来。
 */
const CACHE_TTL_MS = 3000;
const CAMPAIGNS_CACHE_KEY = 'credits:free-campaigns';

interface FreeCampaign {
  id: string;
  onlyNewUsers: boolean;
}

@Injectable()
export class CreditPriceService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /** 活动配置变更后立即失效；不调最多等 3 秒 TTL。 */
  async invalidate(): Promise<void> {
    await this.cache.del(CAMPAIGNS_CACHE_KEY);
  }

  /** 该能力命中的限时免费活动 id；未命中返回空串（账单 `promotionId` 用）。 */
  async freeCampaignIdOf(capabilityId: string, userId?: string): Promise<string> {
    const campaignIds = await this.freeCampaignIdsOf([capabilityId], userId);
    return campaignIds.get(String(capabilityId ?? '')) ?? '';
  }

  /** 批量解析能力命中的免费活动；新客身份整批判定一次。 */
  async freeCampaignIdsOf(
    capabilityIds: string[],
    userId?: string,
  ): Promise<Map<string, string>> {
    const campaignsByCapability = await this.campaigns();
    const result = new Map<string, string>();
    const targeted = new Map<string, FreeCampaign>();
    for (const capabilityId of new Set(capabilityIds.map((id) => String(id ?? '')))) {
      const campaigns = campaignsByCapability.get(capabilityId) ?? [];
      const global = campaigns.find((campaign) => !campaign.onlyNewUsers);
      if (global) {
        result.set(capabilityId, global.id);
        continue;
      }
      const onlyNewUsers = campaigns.find((campaign) => campaign.onlyNewUsers);
      if (onlyNewUsers) targeted.set(capabilityId, onlyNewUsers);
    }

    if (targeted.size === 0 || !userId) return result;
    const isNewUser = await this.isNewUser(userId);
    if (!isNewUser) return result;
    for (const [capabilityId, campaign] of targeted) {
      result.set(capabilityId, campaign.id);
    }
    return result;
  }

  /** 进行中的免费活动；命中缓存时直接复用，未命中重建并写回 3 秒 TTL */
  private async campaigns(): Promise<Map<string, FreeCampaign[]>> {
    const cached = await this.cache.get<Map<string, FreeCampaign[]>>(CAMPAIGNS_CACHE_KEY);
    if (cached !== undefined) return cached;
    const campaigns = await this.buildCampaigns();
    await this.cache.set(CAMPAIGNS_CACHE_KEY, campaigns, CACHE_TTL_MS);
    return campaigns;
  }

  private async buildCampaigns(): Promise<Map<string, FreeCampaign[]>> {
    const now = new Date();
    const campaigns = await this.prisma.campaign.findMany({
      where: { type: 'limited_free', status: 'active', startAt: { lte: now }, endAt: { gte: now } },
      select: { id: true, payload: true, audience: true },
    });
    const free = new Map<string, FreeCampaign[]>();
    for (const campaign of campaigns) {
      let payload: { capabilityIds?: string[] };
      try {
        payload = JSON.parse(campaign.payload || '{}') as { capabilityIds?: string[] };
      } catch {
        // payload 决定哪些能力免费；损坏时无法安全命中任何能力，跳过本活动。
        continue;
      }
      let audience: { onlyNewUsers?: boolean } = {};
      try {
        audience = JSON.parse(campaign.audience || '{}') as { onlyNewUsers?: boolean };
      } catch {
        // audience 损坏只影响定向范围，按全站免费处理。
        audience = {};
      }
      for (const id of payload.capabilityIds ?? []) {
        const entries = free.get(id) ?? [];
        entries.push({ id: campaign.id, onlyNewUsers: Boolean(audience.onlyNewUsers) });
        free.set(id, entries);
      }
    }
    return free;
  }

  private async isNewUser(userId: string): Promise<boolean> {
    const paidCount = await this.prisma.order.count({
      where: {
        userId,
        status: { in: ['paid', 'partial_refunded', 'refunded'] },
      },
    });
    return paidCount === 0;
  }
}
