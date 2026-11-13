/**
 * 能力目录快照与解析结果的数据形状。
 *
 * 快照是**只读**的内存投影：装载时把 BigInt 金额转成 number，后续匹配、
 * 计价、展示都读同一份。任何写路径都不能改快照对象 —— 改价后应当递增
 * 目录版本并重新装载，否则两个并发请求会看到不同的价格（且其中一个永远是旧的）。
 */

import type { CapabilitySpec, ModelRequestIntent } from '../intent/spec-types';
import type { TierSummarySource } from '../domain/selector';

/** 快照里的价格档（BigInt 已转 number） */
export interface CachedPriceTier extends TierSummarySource {
  id: string;
  selector: Record<string, string>;
  selectorJson: string;
  resolution: string;
  videoSeconds: number;
  providerModelKey: string;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
  priceConfigured: boolean;
  enabled: boolean;
  /** 价格档版本：改价时递增，账单用它区分「同一档位的哪一版价格」 */
  priceVersion: number;
  costConfigured?: boolean;
  costUnitPriceMicrocredits?: number;
  costInputTokenPriceMicrocredits?: number;
  costOutputTokenPriceMicrocredits?: number;
  costCachedTokenPriceMicrocredits?: number;
}

/** 快照里的渠道模型（含能力合同与成本档） */
export interface CachedChannelModel {
  id: string;
  channelId: string;
  /** 渠道名（后台诊断与账单展示用；公开目录不下发） */
  channelName: string;
  modelKey: string;
  /** C 端模型分组键；空串时调用方回落到 modelKey */
  modelGroupKey: string;
  providerModelKey: string;
  displayName: string;
  icon: string;
  sortOrder: number;
  /** 商品自身启停 */
  enabled: boolean;
  /** 所属渠道启停 */
  channelEnabled: boolean;
  capability: string;
  protocol: string;
  /** 'credits' | 'USD' | 'CNY' */
  priceCurrency: string;
  billingMode: string;
  priceConfigured: boolean;
  /** 渠道模型价格版本：任何成本字段变更都会递增 */
  priceVersion: number;
  priceTiers: CachedPriceTier[];
  capabilitySpec: CapabilitySpec;
}

/** 能力级售价快照 */
export interface CachedCapabilityPricing {
  capabilityId: string;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
  /** false = 未配置且没有可用的默认价（Token 计费能力） */
  configured: boolean;
}

/** 能力 ↔ 渠道模型绑定（候选线路） */
export interface CachedCapabilityBinding {
  id: string;
  capabilityId: string;
  channelModelId: string;
  enabled: boolean;
  priority: number;
  weight: number;
  channelModel: CachedChannelModel;
}

/** 同一能力下、同一分组键的候选线路集合 */
export interface CachedModelGroup {
  modelKey: string;
  displayName: string;
  icon: string;
  lines: CachedCapabilityBinding[];
}

/** 一个能力的完整运行时投影 */
export interface CachedCapability {
  id: string;
  pricing: CachedCapabilityPricing;
  groups: Map<string, CachedModelGroup>;
  orderedGroupKeys: string[];
}

export interface CapabilityCatalogSnapshot {
  capabilities: Map<string, CachedCapability>;
  channelModels: Map<string, CachedChannelModel>;
  loadedAt: number;
  catalogVersion: number;
}

/** 一次选路的完整结果：调用方不得替换其中任何供应侧字段 */
export interface RoutedModel {
  capabilityId: string;
  /** C 端所选模型分组键 */
  modelKey: string;
  binding: CachedCapabilityBinding;
  channelModel: CachedChannelModel;
  capabilitySpec: CapabilitySpec;
  pricing: CachedCapabilityPricing;
  intent: ModelRequestIntent;
  /** 解析时读取的目录版本；账单 `priceVersion` 记录它，便于回溯「哪一版目录算出的价」 */
  catalogVersion: number;
}

/** 模型分组的公开投影 */
export interface PublicModelGroup {
  modelKey: string;
  displayName: string;
  icon: string;
  billingMode: string;
  priceLabel: string;
  amountMicrocredits: number | null;
  available: boolean;
}
