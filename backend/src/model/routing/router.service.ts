/**
 * 选路：能力 + 所选模型 + 意图 → 一条可执行的渠道模型线路。
 *
 * 前台模型层删除后，候选池来自 `CapabilityModelBinding`，规则：
 *   1. 能力存在且启用（下线由 `CapabilityControl` 在目录层过滤）；
 *   2. 绑定 / 商品 / 渠道启用，本轮未试过，未冷却，分组可见，能力合同匹配；
 *   3. 用户选中的模型分组优先（groupRank=0），同能力其它分组只在该分组
 *      全部失败后兜底（groupRank=1）；
 *   4. 有效优先级 = 健康分层 × 1000 + 绑定手工优先级；健康分层优先；
 *   5. 最优层内按 `weight` 加权随机（crypto + 拒绝采样）。
 *
 * 售价在能力级，选路不读价格档；成本档缺失不阻塞执行。
 */

import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { badRequest } from '../domain/json';
import { normalizeCapability } from '../domain/capability-config';
import { getCapability } from '../../capabilities/capability.registry';
import { matchCapability } from '../intent/capability-match';
import { resolveModelRequestIntent, restrictIntentToSpec } from '../intent/model-intent';
import type { CapabilityMatch, ModelRequestIntent } from '../intent/spec-types';
import type { UserGroupAccess } from '../user-groups/user-group.service';
import { CapabilityCatalogService } from '../catalog/capability-catalog.service';
import { RouteHealthService } from './route-health.service';
import { RouteScoreService, type HealthTier } from './route-score.service';
import type {
  CachedCapability,
  CachedCapabilityBinding,
  CachedCapabilityPricing,
  CachedChannelModel,
  RoutedModel,
} from './routing.types';

export interface CapabilityRouteDiagnostics {
  bindingId: string;
  modelKey: string;
  channelModelId: string;
  channelId: string;
  channelName: string;
  capability: string;
  enabled: boolean;
  channelEnabled: boolean;
  groupVisible: boolean;
  blocked: boolean;
  capabilityMatched: boolean;
  matchReasons: string[];
  healthTier: number;
  priority: number;
  effectivePriority: number;
  weight: number;
  groupRank: number;
  eligible: boolean;
  selectedTier: boolean;
}

export interface CapabilitySimulateResult {
  capabilityId: string;
  pricing: CachedCapabilityPricing;
  intent: ModelRequestIntent;
  groups: Array<{
    modelKey: string;
    displayName: string;
    lines: CapabilityRouteDiagnostics[];
  }>;
  selectedChannelModelId: string;
  selectedModelKey: string;
  candidates: number;
  reason: string;
}

@Injectable()
export class RouterService {
  constructor(
    private readonly catalog: CapabilityCatalogService,
    private readonly health: RouteHealthService,
    private readonly scores: RouteScoreService,
  ) {}

  /** 目录里的能力；不存在返回 null，由调用方映射成「模型不可用」 */
  async findCapability(capabilityId: string): Promise<CachedCapability | null> {
    return this.catalog.findCapability(capabilityId);
  }

  /**
   * 解析一次可执行线路。
   *
   * @param tried 已经失败的渠道模型 id 集合。故障切换时传入，保证不会反复
   *              选中同一条已经拒绝过本次请求的线路；首轮传空集。
   */
  async resolve(
    access: UserGroupAccess | null,
    capabilityId: string,
    modelKey: string,
    intent: ModelRequestIntent,
    tried: Set<string> = new Set(),
  ): Promise<RoutedModel> {
    const snapshot = await this.catalog.snapshotOrThrow();
    const capability = snapshot.capabilities.get(String(capabilityId ?? '').trim());
    if (!capability) throw badRequest('所选模型不可用', 40005);

    const definition = getCapability(capability.id);
    if (!definition) throw badRequest('能力不存在', 40005);
    const modality = normalizeCapability(definition.model.capability);
    if (modality && modality !== normalizeCapability(intent.capability)) {
      throw badRequest(`所选能力只接受 ${modality} 类型请求`, 40001);
    }

    const selectedKey = String(modelKey ?? '').trim();
    if (selectedKey && !capability.groups.has(selectedKey)) {
      throw badRequest('所选模型不可用，请重新选择', 40005);
    }

    const tiers = await this.scores.tiers();
    const eligible = this.eligibleLines(access, capability, intent, tried, tiers, selectedKey);
    if (eligible.length === 0) {
      throw badRequest('当前能力暂时无法满足这组输入和参数', 40005);
    }
    const line = weightedRoute(eligible.map((item) => ({ ...item, weight: item.line.weight }))).line;
    if (!line.channelModel.enabled || !line.channelModel.channelEnabled) {
      throw badRequest('当前能力暂时无法满足这组输入和参数', 40005);
    }

    // 线路合同没启用的参数在匹配阶段就应剔除，否则「用户选了模型不支持的画质」
    // 会把整条线路判为不可用；执行期 TaskRequestService 也用同一套裁剪。
    const restricted = restrictIntentToSpec(line.channelModel.capabilitySpec, intent);
    const routedIntent = resolveModelRequestIntent(
      line.channelModel.capabilitySpec,
      restricted,
      {},
    );
    return {
      capabilityId: capability.id,
      modelKey: groupKeyOf(line),
      binding: line,
      channelModel: line.channelModel,
      capabilitySpec: line.channelModel.capabilitySpec,
      pricing: capability.pricing,
      intent: routedIntent,
      catalogVersion: snapshot.catalogVersion,
    };
  }

  /** 目录展示用：该能力是否存在启用且未冷却的线路 */
  async hasHealthyLine(access: UserGroupAccess | null, capabilityId: string): Promise<boolean> {
    const snapshot = await this.catalog.snapshotOrThrow();
    const capability = snapshot.capabilities.get(String(capabilityId ?? '').trim());
    if (!capability) return false;
    const tiers = await this.scores.tiers();
    return this.allLines(capability).some(
      (binding) => this.lineEligible(access, binding, binding.channelModel.capabilitySpec, null, tiers).eligible,
    );
  }

  /** 目录展示用：某个模型分组是否存在可承接该意图的线路 */
  async groupAvailable(
    access: UserGroupAccess | null,
    capabilityId: string,
    modelKey: string,
    intent: ModelRequestIntent | null,
  ): Promise<boolean> {
    const snapshot = await this.catalog.snapshotOrThrow();
    const capability = snapshot.capabilities.get(String(capabilityId ?? '').trim());
    const group = capability?.groups.get(String(modelKey ?? '').trim());
    if (!capability || !group) return false;
    const tiers = await this.scores.tiers();
    return group.lines.some(
      (binding) => this.lineEligible(access, binding, binding.channelModel.capabilitySpec, intent, tiers).eligible,
    );
  }

  /**
   * 后台路由模拟：不写任务、不扣费，把每条线路的判定原因全部摊开。
   * 结果必须与 `resolve` 的选择一致。
   */
  async simulate(
    access: UserGroupAccess | null,
    capabilityId: string,
    intent: ModelRequestIntent,
    modelKey = '',
  ): Promise<CapabilitySimulateResult> {
    const snapshot = await this.catalog.snapshotOrThrow();
    const capability = snapshot.capabilities.get(String(capabilityId ?? '').trim());
    if (!capability) throw badRequest('所选模型不可用', 40005);
    const tiers = await this.scores.tiers();
    const selectedKey = String(modelKey ?? '').trim();
    if (selectedKey && !capability.groups.has(selectedKey)) {
      throw badRequest('所选模型不可用，请重新选择', 40005);
    }

    const all = this.allLines(capability);
    const diagnostics = all.map((line) => {
      const result = this.lineEligible(access, line, line.channelModel.capabilitySpec, intent, tiers);
      const selected = this.groupRankOf(line, selectedKey);
      return {
        bindingId: line.id,
        modelKey: groupKeyOf(line),
        channelModelId: line.channelModelId,
        channelId: line.channelModel.channelId,
        channelName: line.channelModel.channelName,
        capability: line.channelModel.capability,
        enabled: line.enabled,
        channelEnabled: line.channelModel.enabled && line.channelModel.channelEnabled,
        groupVisible: result.groupVisible,
        blocked: result.blocked,
        capabilityMatched: result.capabilityMatched,
        matchReasons: result.matchReasons,
        healthTier: result.healthTier,
        priority: line.priority,
        effectivePriority: result.healthTier * 1000 + line.priority,
        weight: line.weight,
        groupRank: selected,
        eligible: result.eligible,
        selectedTier: false,
      };
    });

    const eligible = this.eligibleLines(access, capability, intent, new Set(), tiers, selectedKey);
    const selected = eligible.length > 0
      ? weightedRoute(eligible.map((item) => ({ ...item, weight: item.line.weight }))).line
      : null;
    const best = eligible[0];
    for (const item of diagnostics) {
      item.selectedTier = Boolean(
        best &&
          item.bindingId === best.line.id,
      );
    }

    const groups = capability.orderedGroupKeys.map((key) => {
      const group = capability.groups.get(key)!;
      const lines = diagnostics.filter((item) => item.modelKey === key);
      return { modelKey: key, displayName: group.displayName, lines };
    });

    return {
      capabilityId: capability.id,
      pricing: capability.pricing,
      intent,
      groups,
      selectedChannelModelId: selected?.channelModelId ?? '',
      selectedModelKey: selected ? groupKeyOf(selected) : '',
      candidates: eligible.length,
      reason: eligible.length === 0 ? '没有可承接该请求的绑定线路（检查启停、冷却、分组与能力参数）' : '',
    };
  }

  /** 候选池：只保留最优层（groupRank + effectivePriority 都最小） */
  private eligibleLines(
    access: UserGroupAccess | null,
    capability: CachedCapability,
    intent: ModelRequestIntent,
    tried: Set<string>,
    tiers: Map<string, HealthTier>,
    selectedKey: string,
  ): Array<{ line: CachedCapabilityBinding; groupRank: number; effectivePriority: number }> {
    const result: Array<{ line: CachedCapabilityBinding; groupRank: number; effectivePriority: number }> = [];
    let bestGroupRank = Number.POSITIVE_INFINITY;
    let bestPriority = Number.POSITIVE_INFINITY;
    for (const line of this.allLines(capability)) {
      if (tried.has(line.channelModelId)) continue;
      const checked = this.lineEligible(access, line, line.channelModel.capabilitySpec, intent, tiers);
      if (!checked.eligible) continue;
      const groupRank = this.groupRankOf(line, selectedKey);
      const effectivePriority = checked.healthTier * 1000 + line.priority;
      if (groupRank < bestGroupRank || (groupRank === bestGroupRank && effectivePriority < bestPriority)) {
        result.length = 0;
        bestGroupRank = groupRank;
        bestPriority = effectivePriority;
      }
      if (groupRank === bestGroupRank && effectivePriority === bestPriority) {
        result.push({ line, groupRank, effectivePriority });
      }
    }
    return result;
  }

  private lineEligible(
    access: UserGroupAccess | null,
    line: CachedCapabilityBinding,
    spec: CachedChannelModel['capabilitySpec'],
    intent: ModelRequestIntent | null,
    tiers: Map<string, HealthTier>,
  ): {
    eligible: boolean;
    blocked: boolean;
    groupVisible: boolean;
    capabilityMatched: boolean;
    matchReasons: string[];
    healthTier: HealthTier;
  } {
    const groupVisible = access ? access.allowsChannel(line.channelModel.channelId) : true;
    const blocked = this.isBlocked(line);
    const match: CapabilityMatch = intent
      ? matchCapability(spec, restrictIntentToSpec(spec, intent))
      : { matched: true, reasons: [], issues: [] };
    const healthTier = tiers.get(line.channelModelId) ?? 0;
    const eligible =
      line.enabled &&
      line.weight > 0 &&
      line.channelModel.enabled &&
      line.channelModel.channelEnabled &&
      groupVisible &&
      !blocked &&
      match.matched;
    return {
      eligible,
      blocked,
      groupVisible,
      capabilityMatched: match.matched,
      matchReasons: match.reasons ?? [],
      healthTier,
    };
  }

  private isBlocked(line: CachedCapabilityBinding, now = Date.now()): boolean {
    return this.health.isBlocked(
      {
        channelId: line.channelModel.channelId,
        channelModelId: line.channelModelId,
        routeId: line.id,
      },
      now,
    );
  }

  private allLines(capability: CachedCapability): CachedCapabilityBinding[] {
    const result: CachedCapabilityBinding[] = [];
    for (const group of capability.groups.values()) result.push(...group.lines);
    return result;
  }

  private groupRankOf(line: CachedCapabilityBinding, selectedKey: string): number {
    if (!selectedKey) return 0;
    return groupKeyOf(line) === selectedKey ? 0 : 1;
  }
}

function groupKeyOf(line: CachedCapabilityBinding): string {
  return (line.channelModel.modelGroupKey || '').trim() || line.channelModel.modelKey;
}

/**
 * 同层加权随机。使用 `crypto.randomBytes` 而不是 `Math.random`：
 * 权重是容量策略的一部分，可预测的随机源会让「流量倾斜」变成可操控项。
 * 拒绝采样丢弃不能整除 total 的尾部，避免取模造成的轻微权重偏差。
 */
export function weightedRoute<T extends { weight: number }>(routes: T[]): T {
  if (routes.length === 1) return routes[0];
  let total = 0;
  for (const route of routes) total += route.weight;
  if (total <= 0) return routes[0];
  const totalBig = BigInt(total);
  const threshold = (1n << 64n) % totalBig;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const raw = randomBytes(8);
    const value = BigInt(`0x${raw.toString('hex')}`);
    if (value < threshold) continue;
    let cursor = value % totalBig;
    for (const route of routes) {
      if (cursor < BigInt(route.weight)) return route;
      cursor -= BigInt(route.weight);
    }
  }
  return routes[0];
}
