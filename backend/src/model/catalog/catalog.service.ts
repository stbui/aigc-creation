/**
 * 前台目录：把后台配置的模型投影成创作端可见的列表与价格。
 *
 * 移植自 open-ai-canvas `logical_models_catalog.go`。
 *
 * 三条投影规则：
 *   1. **只发布当前分组可见线路上的能力**：分组看不到的渠道不参与能力合并，
 *      否则会承诺一个该用户永远走不到的规格；
 *   2. **价格按分组换算后下发**：目录价必须等于实际扣费，`channel` 策略下
 *      每条价格档都要按该档的计价货币与分组倍率换算；
 *   3. **能力画像是去重后的匿名投影**：不暴露供应渠道、上游模型或线路关系。
 */

import { Injectable } from '@nestjs/common';
import { convertCurrencyPrice, creditAmount, toSafeNumber } from '../infra/microcredits';
import { decodeSkuSelector, type SkuSelector } from '../domain/selector';
import {
  capabilityFingerprint,
  capabilitySpecWithRoutePresets,
  logicalModelCapabilityCovered,
} from '../intent/capability-spec';
import type { CapabilitySpec, ModelRequestIntent } from '../intent/spec-types';
import type { UserGroupAccess } from '../user-groups/user-group.service';
import { RouteCatalogService } from './route-catalog.service';
import { RouterService } from '../routing/router.service';
import type { CachedLogicalModel, CachedLogicalRoute } from '../routing/routing.types';

export interface PublicLogicalModelPriceTier {
  selector: SkuSelector;
  resolution: string;
  videoSeconds: number;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
}

export interface PublicLogicalModel {
  id: string;
  code: string;
  name: string;
  icon: string;
  description: string;
  capability: string;
  sortOrder: number;
  pricePolicy: string;
  pricingMode: string;
  displayPrice: number | null;
  priceLabel: string;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputPriceMicrocredits: number;
  outputPriceMicrocredits: number;
  cachedPriceMicrocredits: number;
  priceTiers: PublicLogicalModelPriceTier[];
  legacyModelIds: string[];
  capabilitySpec: CapabilitySpec;
  capabilityProfiles: CapabilitySpec[];
  defaultOptions: Record<string, unknown>;
  available: boolean;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly routeCatalog: RouteCatalogService,
    private readonly router: RouterService,
  ) {}

  /** 公开目录：全部可见模型（`intent` 给出时按意图过滤并重算 available） */
  async publicModels(access: UserGroupAccess, intent?: ModelRequestIntent): Promise<PublicLogicalModel[]> {
    const snapshot = await this.routeCatalog.snapshotOrThrow();
    const result: PublicLogicalModel[] = [];
    for (const id of snapshot.ordered) {
      const cached = snapshot.models.get(id);
      if (!cached) continue;
      const projected = this.projectForGroup(access, cached);
      if (!projected) continue;
      const available = this.computeAvailable(access, projected, intent);
      if (intent && !available) continue;
      result.push(this.toPublicModel(projected, available));
    }
    return result;
  }

  /** 单个模型的公开投影；不存在或分组不可见返回 null */
  async publicModel(access: UserGroupAccess, logicalModelId: string): Promise<PublicLogicalModel | null> {
    const snapshot = await this.routeCatalog.snapshotOrThrow();
    const cached = snapshot.models.get(String(logicalModelId ?? '').trim());
    if (!cached) return null;
    const projected = this.projectForGroup(access, cached);
    if (!projected) return null;
    return this.toPublicModel(projected, this.computeAvailable(access, projected));
  }

  /**
   * 按分组过滤线路并换算价格（返回副本，不修改共享快照）。
   * 没有任何可见线路时返回 null —— 该模型对当前分组不存在。
   */
  projectForGroup(access: UserGroupAccess, cached: CachedLogicalModel): CachedLogicalModel | null {
    const multiplier = access.pricing('credits', [cached.code]).multiplierBasisPoints;
    const routes: CachedLogicalRoute[] = [];
    for (const route of cached.routes) {
      if (!access.allowsChannel(route.channelModel.channelId)) continue;
      if (cached.pricePolicy !== 'channel') {
        routes.push(route);
        continue;
      }
      const pricing = access.pricing(route.channelModel.priceCurrency, [cached.code, route.channelModel.modelKey]);
      routes.push({
        ...route,
        channelModel: {
          ...route.channelModel,
          priceTiers: route.channelModel.priceTiers.map((tier) => ({
            ...tier,
            // 先按计价货币换算成微积分，再叠分组倍率 —— 顺序反过来会把倍率乘进货币口径
            unitPriceMicrocredits: applyMultiplier(
              toSafeNumber(convertCurrencyPrice(tier.unitPriceMicrocredits, pricing.rateMicrocredits)),
              multiplier,
            ),
            inputTokenPriceMicrocredits: applyMultiplier(
              toSafeNumber(convertCurrencyPrice(tier.inputTokenPriceMicrocredits, pricing.rateMicrocredits)),
              multiplier,
            ),
            outputTokenPriceMicrocredits: applyMultiplier(
              toSafeNumber(convertCurrencyPrice(tier.outputTokenPriceMicrocredits, pricing.rateMicrocredits)),
              multiplier,
            ),
            cachedTokenPriceMicrocredits: applyMultiplier(
              toSafeNumber(convertCurrencyPrice(tier.cachedTokenPriceMicrocredits, pricing.rateMicrocredits)),
              multiplier,
            ),
          })),
        },
      });
    }
    if (routes.length === 0 && cached.routes.length > 0) return null;

    const result: CachedLogicalModel = { ...cached, routes };
    if (cached.pricePolicy !== 'channel') {
      result.unitPriceMicrocredits = applyMultiplier(cached.unitPriceMicrocredits, multiplier);
      result.inputPriceMicrocredits = applyMultiplier(cached.inputPriceMicrocredits, multiplier);
      result.outputPriceMicrocredits = applyMultiplier(cached.outputPriceMicrocredits, multiplier);
      result.cachedPriceMicrocredits = applyMultiplier(cached.cachedPriceMicrocredits, multiplier);
    }
    return result;
  }

  /** 可用性：结构覆盖 + 存在健康线路；给出意图时还要求有线路能承接 */
  computeAvailable(
    access: UserGroupAccess,
    cached: CachedLogicalModel,
    intent?: ModelRequestIntent,
  ): boolean {
    const structuralSpecs = cached.routes
      .filter((route) => route.enabled && route.weight > 0)
      .map((route) => route.channelModel.capabilitySpec);
    const coverageValid = logicalModelCapabilityCovered(cached.productSpec, structuralSpecs);
    const healthy = this.router.hasHealthyRoute(cached.routes);
    if (!intent) return coverageValid && healthy;
    if (!coverageValid) return false;
    const resolved = this.router.resolveIntent(cached, intent);
    return this.router.hasCompatibleRoute(access, cached, resolved);
  }

  /** 公开投影：能力含各线路预设并集，画像按指纹去重 */
  toPublicModel(cached: CachedLogicalModel, available: boolean): PublicLogicalModel {
    const enabledSpecs = cached.routes
      .filter((route) => route.enabled && route.weight > 0)
      .map((route) => route.channelModel.capabilitySpec);
    const productSpec = capabilitySpecWithRoutePresets(cached.productSpec, enabledSpecs);
    const profiles: CapabilitySpec[] = [];
    const seen = new Set<string>();
    for (const spec of enabledSpecs) {
      const key = capabilityFingerprint(spec);
      if (seen.has(key)) continue;
      seen.add(key);
      profiles.push(spec);
    }
    const priceTiers = this.publicPriceTiers(cached);
    const { pricingMode, displayPrice, priceLabel } = computeModelPriceDisplay(cached, priceTiers);
    return {
      id: cached.id,
      code: cached.code,
      name: cached.name,
      icon: cached.icon,
      description: cached.description,
      capability: cached.capability,
      sortOrder: cached.sortOrder,
      pricePolicy: cached.pricePolicy,
      pricingMode,
      displayPrice,
      priceLabel,
      billingMode: cached.billingMode,
      unitPriceMicrocredits: cached.unitPriceMicrocredits,
      inputPriceMicrocredits: cached.inputPriceMicrocredits,
      outputPriceMicrocredits: cached.outputPriceMicrocredits,
      cachedPriceMicrocredits: cached.cachedPriceMicrocredits,
      priceTiers,
      legacyModelIds: cached.legacyModelIds,
      capabilitySpec: productSpec,
      capabilityProfiles: profiles,
      defaultOptions: cached.defaults,
      available,
    };
  }

  /** 价格档投影：只保留启用且已配置价格、且选择器合法的档，按规格去重 */
  private publicPriceTiers(cached: CachedLogicalModel): PublicLogicalModelPriceTier[] {
    if (cached.pricePolicy !== 'channel') return [];
    const result: PublicLogicalModelPriceTier[] = [];
    const seen = new Set<string>();
    for (const route of cached.routes) {
      if (!route.enabled || route.weight <= 0) continue;
      const parameters = route.channelModel.capabilitySpec.imageParameters;
      for (const tier of route.channelModel.priceTiers) {
        if (!tier.enabled || !tier.priceConfigured) continue;
        const selector = parameters ? decodeSkuSelector(tier.selectorJson) : tier.selector;
        const key = JSON.stringify({
          selector,
          billingMode: tier.billingMode,
          unit: tier.unitPriceMicrocredits,
          input: tier.inputTokenPriceMicrocredits,
          output: tier.outputTokenPriceMicrocredits,
          cached: tier.cachedTokenPriceMicrocredits,
        });
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
          selector,
          resolution: tier.resolution,
          videoSeconds: tier.videoSeconds,
          billingMode: tier.billingMode,
          unitPriceMicrocredits: tier.unitPriceMicrocredits,
          inputTokenPriceMicrocredits: tier.inputTokenPriceMicrocredits,
          outputTokenPriceMicrocredits: tier.outputTokenPriceMicrocredits,
          cachedTokenPriceMicrocredits: tier.cachedTokenPriceMicrocredits,
        });
      }
    }
    return result;
  }
}

function applyMultiplier(price: number, multiplierBasisPoints: bigint): number {
  if (price <= 0) return price;
  return toSafeNumber(creditAmount(price, 1, multiplierBasisPoints));
}

/** 价格展示：channel 策略看档，unified 看标量价与计费方式 */
export function computeModelPriceDisplay(
  model: Pick<CachedLogicalModel, 'pricePolicy' | 'billingMode' | 'unitPriceMicrocredits' | 'inputPriceMicrocredits' | 'outputPriceMicrocredits'>,
  priceTiers: PublicLogicalModelPriceTier[],
): { pricingMode: string; displayPrice: number | null; priceLabel: string } {
  if (model.pricePolicy === 'channel') {
    if (priceTiers.length === 0) return { pricingMode: 'provider', displayPrice: null, priceLabel: '未配置' };
    if (priceTiers.length === 1) {
      const unit = tierDisplayPrice(priceTiers[0]);
      if (unit > 0) return { pricingMode: 'provider', displayPrice: unit, priceLabel: '' };
    }
    return { pricingMode: 'provider', displayPrice: null, priceLabel: '按渠道规格计费' };
  }
  if ((model.billingMode === 'fixed_request' || model.billingMode === 'per_second') && model.unitPriceMicrocredits > 0) {
    return {
      pricingMode: 'unified',
      displayPrice: model.unitPriceMicrocredits,
      priceLabel: model.billingMode === 'per_second' ? '按秒' : '',
    };
  }
  if (model.billingMode === 'token' && (model.inputPriceMicrocredits > 0 || model.outputPriceMicrocredits > 0)) {
    return { pricingMode: 'unified', displayPrice: null, priceLabel: '按 Token' };
  }
  return { pricingMode: 'unified', displayPrice: null, priceLabel: '未配置' };
}

function tierDisplayPrice(tier: PublicLogicalModelPriceTier): number {
  if (tier.billingMode === 'fixed_request' || tier.billingMode === 'per_second') return tier.unitPriceMicrocredits;
  if (tier.outputTokenPriceMicrocredits > 0) return tier.outputTokenPriceMicrocredits;
  if (tier.inputTokenPriceMicrocredits > 0) return tier.inputTokenPriceMicrocredits;
  return 0;
}
