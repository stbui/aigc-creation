/**
 * 选路：请求意图 → 一条可执行的线路。
 *
 * 移植自 open-ai-canvas `internal/app/model_router.go` 的 `ResolveLogicalModel` /
 * `eligibleLogicalRoutes` / `weightedRoute`。
 *
 * 选路规则（顺序不可变，改动等于改资损口径）：
 *   1. 意图书 + 默认参数归一，图片参数按合同校验；
 *   2. 产品能力合同匹配 —— 不匹配直接拒绝，不尝试线路；
 *   3. 候选池：启用 / weight>0 / 本轮未试过 / 未冷却 / 分组可见 /
 *      线路能力匹配 / （channel 策略）有命中价格档；
 *   4. **只保留最高 priority 一层**（硬分层，高优先级只要有一条可用，
 *      低优先级不会分流）；
 *   5. 同层按 weight 加权随机（crypto 随机 + 拒绝采样，避免取模偏差）。
 *
 * 调用方拿到 `RoutedModel` 后**不得替换**供应侧字段：任务快照、账单、
 * 调用日志必须来自同一次解析结果，否则会出现「目录显示 A、实际走 B」。
 */

import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { badRequest } from '../domain/json';
import { matchCapability } from '../intent/capability-match';
import { resolveImageParameterValues } from '../intent/image-contract';
import { resolveModelRequestIntent } from '../intent/model-intent';
import type { CapabilityMatch, ModelRequestIntent } from '../intent/spec-types';
import { RouteCatalogService } from '../catalog/route-catalog.service';
import type { UserGroupAccess } from '../user-groups/user-group.service';
import { PriceTierService } from './price-tier.service';
import { RouteHealthService } from './route-health.service';
import type { CachedLogicalModel, CachedLogicalRoute, CachedPriceTier, RoutedModel } from './routing.types';

export interface RouteDiagnostics {
  routeId: string;
  channelModelId: string;
  channelId: string;
  channelModelKey: string;
  priority: number;
  weight: number;
  enabled: boolean;
  groupVisible: boolean;
  blocked: boolean;
  capabilityMatched: boolean;
  matchReasons: string[];
  priceTierId: string;
  priceSelector: Record<string, string>;
  priceTierMissing: boolean;
  eligible: boolean;
  /** 只有最终被选中的那一层保留 true */
  selectedTier: boolean;
}

export interface SimulateResult {
  logicalModel: {
    id: string;
    code: string;
    name: string;
    capability: string;
    pricePolicy: string;
    billingMode: string;
    revisionId: string;
    revisionVersion: number;
    enabled: boolean;
    archived: boolean;
  };
  intent: ModelRequestIntent;
  defaults: Record<string, unknown>;
  productMatch: CapabilityMatch;
  routes: RouteDiagnostics[];
  selectedRouteId: string;
  selectedPriceTierId: string;
  candidates: number;
  reason: string;
}

@Injectable()
export class RouterService {
  constructor(
    private readonly catalog: RouteCatalogService,
    private readonly health: RouteHealthService,
    private readonly priceTiers: PriceTierService,
  ) {}

  /**
   * 目录里的前台模型（准入按它的能力合同裁剪意图参数）。
   *
   * 返回 `null` 而不是抛错：调用方要把它映射成「模型已下线」的 40005，
   * 与参数错误区分开 —— 前端据此显示「换个模型」而不是「参数填错了」。
   */
  async findModel(logicalModelId: string): Promise<CachedLogicalModel | null> {
    const snapshot = await this.catalog.snapshotOrThrow();
    return snapshot.models.get(String(logicalModelId ?? '').trim()) ?? null;
  }

  /**
   * 解析一次可执行路由；失败时给出可直接展示给用户的原因。
   *
   * @param tried 已经失败的线路 id 集合。故障切换时传入，保证不会反复选中
   *              同一条已经拒绝过本次请求的线路；首轮传空集。
   */
  async resolve(
    access: UserGroupAccess | null,
    logicalModelId: string,
    intent: ModelRequestIntent,
    tried: Set<string> = new Set(),
  ): Promise<RoutedModel> {
    const snapshot = await this.catalog.snapshotOrThrow();
    const cached = snapshot.models.get(String(logicalModelId ?? '').trim());
    if (!cached) throw badRequest('所选模型不可用');

    const resolved = this.resolveIntent(cached, intent);
    const productMatch = matchCapability(cached.productSpec, resolved);
    if (!productMatch.matched) throw badRequest(productMismatchMessage(productMatch));

    const requirePriceTier = cached.pricePolicy === 'channel';
    const eligible = this.eligibleRoutes(access, cached.routes, resolved, tried, requirePriceTier);
    if (eligible.length === 0) throw badRequest('当前模型暂时无法满足这组输入和参数');
    const selected = weightedRoute(eligible);

    let priceTier: CachedPriceTier | null = null;
    if (requirePriceTier) {
      priceTier = this.priceTiers.tierForIntent(selected.channelModel, resolved);
      if (!priceTier) throw badRequest('当前模型尚未配置所选规格的价格');
    }
    return {
      logicalModel: cached,
      revisionId: cached.revisionId,
      revisionVersion: cached.revisionVersion,
      route: selected,
      channelModel: selected.channelModel,
      capabilitySpec: selected.channelModel.capabilitySpec,
      priceTier,
      defaults: cached.defaults,
      intent: resolved,
      catalogVersion: snapshot.catalogVersion,
    };
  }

  /** 意图归一 + 图片参数合同校验（产品合同侧，先于线路匹配） */
  resolveIntent(cached: CachedLogicalModel, intent: ModelRequestIntent): ModelRequestIntent {
    const resolved = resolveModelRequestIntent(cached.productSpec, intent, cached.defaults);
    if (cached.productSpec.imageParameters) {
      resolveImageParameterValues(cached.productSpec.imageParameters, resolved.options);
    }
    return resolved;
  }

  /**
   * 候选池：priority 硬分层。返回同层全部可用线路（可能为空）。
   */
  eligibleRoutes(
    access: UserGroupAccess | null,
    routes: CachedLogicalRoute[],
    intent: ModelRequestIntent,
    tried: Set<string>,
    requirePriceTier: boolean,
    now = Date.now(),
  ): CachedLogicalRoute[] {
    const eligible: CachedLogicalRoute[] = [];
    let maxPriority = Number.NEGATIVE_INFINITY;
    for (const route of routes) {
      if (!route.enabled || route.weight <= 0 || tried.has(route.id)) continue;
      if (this.isBlocked(route, now)) continue;
      if (access && !access.allowsChannel(route.channelModel.channelId)) continue;
      if (!matchCapability(route.channelModel.capabilitySpec, intent).matched) continue;
      if (requirePriceTier && !this.priceTiers.tierForIntent(route.channelModel, intent)) continue;
      if (route.priority > maxPriority) {
        eligible.length = 0;
        maxPriority = route.priority;
      }
      if (route.priority === maxPriority) eligible.push(route);
    }
    return eligible;
  }

  /** 线路是否在冷却中（渠道 / 渠道模型 / 线路三键） */
  isBlocked(route: CachedLogicalRoute, now = Date.now()): boolean {
    return this.health.isBlocked(
      { channelId: route.channelModel.channelId, channelModelId: route.channelModel.id, routeId: route.id },
      now,
    );
  }

  /** 目录展示用：该模型是否存在「启用且未冷却」的线路 */
  hasHealthyRoute(routes: CachedLogicalRoute[], now = Date.now()): boolean {
    return routes.some((route) => route.enabled && route.weight > 0 && !this.isBlocked(route, now));
  }

  /** 目录发现用：给定意图是否存在可承接的线路（含价格档兼容） */
  hasCompatibleRoute(
    access: UserGroupAccess | null,
    cached: CachedLogicalModel,
    intent: ModelRequestIntent,
  ): boolean {
    const requirePriceTier = cached.pricePolicy === 'channel';
    const now = Date.now();
    return cached.routes.some((route) => {
      if (!route.enabled || route.weight <= 0 || this.isBlocked(route, now)) return false;
      if (access && !access.allowsChannel(route.channelModel.channelId)) return false;
      if (!matchCapability(route.channelModel.capabilitySpec, intent).matched) return false;
      return !requirePriceTier || this.priceTiers.hasCompatibleTier(route.channelModel, intent);
    });
  }

  /**
   * 后台路由模拟：不写任务、不扣费，把每条线路的判定原因全部摊开。
   * 结果必须与 `resolve` 的选择一致 —— 两处只能用同一套 `eligibleRoutes`。
   */
  async simulate(
    access: UserGroupAccess | null,
    logicalModelId: string,
    intent: ModelRequestIntent,
  ): Promise<SimulateResult> {
    const snapshot = await this.catalog.snapshotOrThrow();
    const cached = snapshot.models.get(String(logicalModelId ?? '').trim());
    if (!cached) throw badRequest('所选模型不可用');

    const resolved = this.resolveIntent(cached, intent);
    const productMatch = matchCapability(cached.productSpec, resolved);
    const requirePriceTier = cached.pricePolicy === 'channel';
    const now = Date.now();
    const eligible = productMatch.matched
      ? this.eligibleRoutes(access, cached.routes, resolved, new Set(), requirePriceTier, now)
      : [];
    const selected = eligible.length > 0 ? weightedRoute(eligible) : null;
    const topPriority = eligible.length > 0 ? eligible[0].priority : Number.NEGATIVE_INFINITY;

    const routes: RouteDiagnostics[] = cached.routes.map((route) => {
      const match = matchCapability(route.channelModel.capabilitySpec, resolved);
      const tier = requirePriceTier ? this.priceTiers.tierForIntent(route.channelModel, resolved) : null;
      const groupVisible = access ? access.allowsChannel(route.channelModel.channelId) : true;
      const blocked = this.isBlocked(route, now);
      return {
        routeId: route.id,
        channelModelId: route.channelModel.id,
        channelId: route.channelModel.channelId,
        channelModelKey: route.channelModel.modelKey,
        priority: route.priority,
        weight: route.weight,
        enabled: route.enabled,
        groupVisible,
        blocked,
        capabilityMatched: match.matched,
        matchReasons: match.reasons,
        priceTierId: tier?.id ?? '',
        priceSelector: tier?.selector ?? {},
        priceTierMissing: requirePriceTier && !tier,
        eligible: eligible.some((item) => item.id === route.id),
        selectedTier: eligible.length > 0 && route.priority === topPriority,
      };
    });

    return {
      logicalModel: {
        id: cached.id,
        code: cached.code,
        name: cached.name,
        capability: cached.capability,
        pricePolicy: cached.pricePolicy,
        billingMode: cached.billingMode,
        revisionId: cached.revisionId,
        revisionVersion: cached.revisionVersion,
        enabled: cached.enabled,
        archived: cached.archivedAt !== null,
      },
      intent: resolved,
      defaults: cached.defaults,
      productMatch,
      routes,
      selectedRouteId: selected?.id ?? '',
      selectedPriceTierId:
        selected && requirePriceTier
          ? this.priceTiers.tierForIntent(selected.channelModel, resolved)?.id ?? ''
          : '',
      candidates: eligible.length,
      reason: productMatch.matched
        ? eligible.length === 0
          ? '没有可承接该请求的线路（检查分组可见性、冷却状态与价格档）'
          : ''
        : '前台模型能力合同不接受该请求',
    };
  }

}

/**
 * 同层加权随机。使用 `crypto.randomBytes` 而不是 `Math.random`：
 * 权重是计费与容量策略的一部分，可预测的随机源会让「流量倾斜」变成可操控项。
 * 拒绝采样丢弃不能整除 total 的尾部，避免取模造成的轻微权重偏差。
 */
export function weightedRoute<T extends { weight: number }>(routes: T[]): T {
  if (routes.length === 1) return routes[0];
  let total = 0;
  for (const route of routes) total += route.weight;
  if (total <= 0) return routes[0];
  const totalBig = BigInt(total);
  // 阈值 = 2^64 mod total：小于阈值的随机值映射不均匀，必须丢弃重抽
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
  // 连续 16 次落入拒绝区间的概率低于 2^-512；仍出现则退化为等权首条
  return routes[0];
}

/** 能力不匹配的可读错误（只暴露第一条原因，避免前端堆叠技术细节） */
export function productMismatchMessage(match: CapabilityMatch): string {
  const first = match.reasons[0];
  return first ? `所选模型不支持当前请求：${first}` : '所选模型不支持当前请求';
}
