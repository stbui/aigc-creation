/**
 * 能力目录快照：能力 → 绑定线路 → 渠道模型 → 成本档 的内存投影。
 *
 * 这是前台模型层删除后的唯一运行时供给目录：
 *   1. **能力是售卖单元**：每个能力一套售价（`CapabilityPricing`），
 *      不再有 per-model 的前台模型 / revision / route；
 *   2. **绑定是候选池**：`CapabilityModelBinding` 决定某能力能用哪些商品，
 *      运行时再按启停、冷却、分组可见与能力合同过滤；
 *   3. **模型分组只读派生**：同一能力下 `modelGroupKey` 相同的商品合并成
 *      C 端的一个模型选项，不落表。
 *
 * 缓存规则与旧路由目录一致：TTL 30s、最大过期 5min、刷新失败冷却 2s、
 * 首次装载失败直接报错（不拿空目录当「全部不可用」）。
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { getCapability, defaultCreditCostOf } from '../../capabilities/capability.registry';
import { CatalogVersionService } from '../infra/catalog-version.service';
import { CREDIT_SCALE } from '../infra/microcredits';
import { toNumber } from '../channels/channel.presentation';
import { projectCachedChannelModel } from '../routing/channel-model.projection';
import type {
  CachedCapability,
  CachedCapabilityBinding,
  CachedCapabilityPricing,
  CachedChannelModel,
  CachedModelGroup,
  CapabilityCatalogSnapshot,
} from '../routing/routing.types';

const SNAPSHOT_TTL_MS = 30_000;
const SNAPSHOT_MAX_STALE_MS = 5 * 60_000;
const REFRESH_RETRY_COOLDOWN_MS = 2_000;

@Injectable()
export class CapabilityCatalogService implements OnModuleInit {
  private readonly log = new Logger(CapabilityCatalogService.name);
  private snapshot: CapabilityCatalogSnapshot | null = null;
  private refreshing: Promise<CapabilityCatalogSnapshot> | null = null;
  private refreshError: Error | null = null;
  private retryAt = 0;
  private lastVersion = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogVersion: CatalogVersionService,
  ) {}

  onModuleInit(): void {
    this.catalogVersion.onChange(() => this.invalidateLocal());
  }

  /** 丢弃本地快照；版本号由写入方负责递增 */
  invalidateLocal(): void {
    this.snapshot = null;
    this.refreshError = null;
    this.retryAt = 0;
  }

  async snapshotNow(): Promise<CapabilityCatalogSnapshot> {
    return this.snapshotOrThrow();
  }

  async snapshotOrThrow(): Promise<CapabilityCatalogSnapshot> {
    const now = Date.now();
    const current = this.snapshot;
    if (current && now - current.loadedAt < SNAPSHOT_TTL_MS) return current;

    if (this.refreshing) return this.refreshing;

    const stale = current && now - current.loadedAt <= SNAPSHOT_MAX_STALE_MS ? current : null;
    if (this.refreshError && now < this.retryAt) {
      if (stale) return stale;
      throw this.refreshError;
    }

    this.refreshing = this.refresh()
      .then((loaded) => {
        this.snapshot = loaded;
        this.refreshError = null;
        this.retryAt = 0;
        return loaded;
      })
      .catch((error: unknown) => {
        const failure = error instanceof Error ? error : new Error(String(error));
        this.refreshError = failure;
        this.retryAt = Date.now() + REFRESH_RETRY_COOLDOWN_MS;
        this.log.error(`能力目录刷新失败，${REFRESH_RETRY_COOLDOWN_MS}ms 后重试：${failure.message}`);
        if (stale) return stale;
        throw failure;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  /** 按渠道模型 id 取快照（任务执行期重建请求用） */
  async findChannelModel(id: string): Promise<CachedChannelModel | null> {
    const key = String(id ?? '').trim();
    if (!key) return null;
    const snapshot = await this.snapshotOrThrow();
    return snapshot.channelModels.get(key) ?? null;
  }

  /** 按能力 id 取快照 */
  async findCapability(id: string): Promise<CachedCapability | null> {
    const key = String(id ?? '').trim();
    if (!key) return null;
    const snapshot = await this.snapshotOrThrow();
    return snapshot.capabilities.get(key) ?? null;
  }

  async refresh(): Promise<CapabilityCatalogSnapshot> {
    const startedAt = Date.now();
    const version = await this.readVersion();

    const [bindings, pricingRows, channelModels, channels] = await Promise.all([
      this.prisma.capabilityModelBinding.findMany({
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.capabilityPricing.findMany(),
      this.prisma.channelModel.findMany({ where: { deletedAt: null } }),
      this.prisma.modelChannel.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, enabled: true },
      }),
    ]);

    const tiers = channelModels.length
      ? await this.prisma.channelModelPriceTier.findMany({
          where: {
            channelModelId: { in: channelModels.map((row) => row.id) },
            deletedAt: null,
          },
          orderBy: [{ createdAt: 'asc' }],
        })
      : [];

    const channelById = new Map(channels.map((row) => [row.id, row]));
    const channelModelsById = new Map<string, CachedChannelModel>();
    for (const row of channelModels) {
      const channel = channelById.get(row.channelId);
      try {
        const cached = projectCachedChannelModel(row, tiers);
        if (channel) {
          cached.channelName = channel.name;
          cached.channelEnabled = channel.enabled;
        }
        channelModelsById.set(row.id, cached);
      } catch (error) {
        this.log.warn(`渠道模型被排除出能力目录 id=${row.id}：能力配置非法（${describe(error)}）`);
      }
    }

    const pricingByCapability = new Map(pricingRows.map((row) => [row.capabilityId, row]));
    const capabilities = new Map<string, CachedCapability>();

    for (const binding of bindings) {
      const definition = getCapability(binding.capabilityId);
      if (!definition) continue;
      const channelModel = channelModelsById.get(binding.channelModelId);
      if (!channelModel) continue;
      const capability = ensureCapability(capabilities, binding.capabilityId, pricingByCapability.get(binding.capabilityId));
      const groupKey = (channelModel.modelGroupKey || '').trim() || channelModel.modelKey;
      let group = capability.groups.get(groupKey);
      if (!group) {
        group = {
          modelKey: groupKey,
          displayName: channelModel.displayName || channelModel.modelKey,
          icon: channelModel.icon,
          lines: [],
        };
        capability.groups.set(groupKey, group);
        capability.orderedGroupKeys.push(groupKey);
      } else if (
        channelModel.displayName &&
        (binding.priority < (group.lines[0]?.priority ?? Number.POSITIVE_INFINITY) ||
          (!group.displayName && channelModel.displayName))
      ) {
        group.displayName = channelModel.displayName;
        group.icon = channelModel.icon;
      }
      const line: CachedCapabilityBinding = {
        id: binding.id,
        capabilityId: binding.capabilityId,
        channelModelId: binding.channelModelId,
        enabled: binding.enabled,
        priority: binding.priority,
        weight: binding.weight,
        channelModel,
      };
      group.lines.push(line);
    }

    for (const capability of capabilities.values()) {
      capability.orderedGroupKeys.sort((left, right) => {
        const a = capability.groups.get(left);
        const b = capability.groups.get(right);
        const ap = Math.min(...(a?.lines.map((line) => line.priority) ?? [0]));
        const bp = Math.min(...(b?.lines.map((line) => line.priority) ?? [0]));
        if (ap !== bp) return ap - bp;
        return left.localeCompare(right);
      });
      for (const group of capability.groups.values()) {
        group.lines.sort((left, right) => {
          if (left.priority !== right.priority) return left.priority - right.priority;
          if (left.channelModel.sortOrder !== right.channelModel.sortOrder) {
            return left.channelModel.sortOrder - right.channelModel.sortOrder;
          }
          return left.id.localeCompare(right.id);
        });
        const head = group.lines[0];
        if (head) {
          group.displayName = head.channelModel.displayName || head.channelModel.modelKey;
          group.icon = head.channelModel.icon;
        }
      }
    }

    this.log.debug(
      `能力目录装载完成：${capabilities.size} 个能力，${channelModelsById.size} 个渠道模型，版本 ${version}`,
    );
    return { capabilities, channelModels: channelModelsById, loadedAt: startedAt, catalogVersion: version };
  }

  private async readVersion(): Promise<number> {
    try {
      this.lastVersion = await this.catalogVersion.current();
      return this.lastVersion;
    } catch {
      return this.lastVersion;
    }
  }
}

function ensureCapability(
  capabilities: Map<string, CachedCapability>,
  capabilityId: string,
  row:
    | {
        billingMode: string;
        unitPriceMicrocredits: bigint;
        inputTokenPriceMicrocredits: bigint;
        outputTokenPriceMicrocredits: bigint;
        cachedTokenPriceMicrocredits: bigint;
      }
    | undefined,
): CachedCapability {
  const existing = capabilities.get(capabilityId);
  if (existing) return existing;
  const defaultCredits = defaultCreditCostOf(capabilityId);
  const modality = String(getCapability(capabilityId)?.model?.capability ?? '');
  const defaultBillingMode = modality === 'text' ? 'token' : 'fixed_request';
  const pricing: CachedCapabilityPricing = row
    ? {
        capabilityId,
        billingMode: row.billingMode,
        unitPriceMicrocredits: toNumber(row.unitPriceMicrocredits),
        inputTokenPriceMicrocredits: toNumber(row.inputTokenPriceMicrocredits),
        outputTokenPriceMicrocredits: toNumber(row.outputTokenPriceMicrocredits),
        cachedTokenPriceMicrocredits: toNumber(row.cachedTokenPriceMicrocredits),
        configured: true,
      }
    : {
        capabilityId,
        billingMode: defaultBillingMode,
        unitPriceMicrocredits: defaultBillingMode === 'fixed_request' ? Number(CREDIT_SCALE) * defaultCredits : 0,
        inputTokenPriceMicrocredits: 0,
        outputTokenPriceMicrocredits: 0,
        cachedTokenPriceMicrocredits: 0,
        configured: defaultBillingMode !== 'token',
      };
  const capability: CachedCapability = {
    id: capabilityId,
    pricing,
    groups: new Map<string, CachedModelGroup>(),
    orderedGroupKeys: [],
  };
  capabilities.set(capabilityId, capability);
  return capability;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
