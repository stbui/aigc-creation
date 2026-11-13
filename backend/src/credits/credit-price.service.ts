import { Injectable } from '@nestjs/common';
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

interface FreeCampaign {
  id: string;
  onlyNewUsers: boolean;
}

@Injectable()
export class CreditPriceService {
  /** 能力 id → 进行中的免费活动。 */
  private freeCampaigns = new Map<string, FreeCampaign[]>();
  private cacheAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  /** 活动配置变更后立即失效；不调最多等 3 秒 TTL。 */
  invalidate(): void {
    this.freeCampaigns.clear();
    this.cacheAt = 0;
  }

  /** 该能力命中的限时免费活动 id；未命中返回空串（账单 `promotionId` 用）。 */
  async freeCampaignIdOf(capabilityId: string, userId?: string): Promise<string> {
    if (Date.now() - this.cacheAt > CACHE_TTL_MS) await this.refresh();
    const campaigns = this.freeCampaigns.get(String(capabilityId ?? '')) ?? [];
    const global = campaigns.find((campaign) => !campaign.onlyNewUsers);
    if (global) return global.id;

    const targeted = campaigns.find((campaign) => campaign.onlyNewUsers);
    if (!targeted || !userId) return '';
    return (await this.isNewUser(userId)) ? targeted.id : '';
  }

  private async refresh(): Promise<void> {
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
    this.freeCampaigns = free;
    this.cacheAt = Date.now();
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
