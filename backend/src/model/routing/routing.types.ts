/**
 * 路由目录快照与解析结果的数据形状。
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
}

/** 快照里的渠道模型（含能力合同与价格档） */
export interface CachedChannelModel {
  id: string;
  channelId: string;
  modelKey: string;
  providerModelKey: string;
  displayName: string;
  capability: string;
  protocol: string;
  /** 'credits' | 'USD' | 'CNY' */
  priceCurrency: string;
  billingMode: string;
  priceConfigured: boolean;
  /** 渠道模型价格版本：任何售价字段变更都会递增 */
  priceVersion: number;
  priceTiers: CachedPriceTier[];
  capabilitySpec: CapabilitySpec;
}

/** 前台模型 revision 的一条线路 */
export interface CachedLogicalRoute {
  id: string;
  channelModelId: string;
  enabled: boolean;
  priority: number;
  weight: number;
  channelModel: CachedChannelModel;
}

/** 快照里的前台模型（含已发布的 revision 与可用线路） */
export interface CachedLogicalModel {
  id: string;
  code: string;
  name: string;
  icon: string;
  description: string;
  capability: string;
  sortOrder: number;
  enabled: boolean;
  pricePolicy: string;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputPriceMicrocredits: number;
  outputPriceMicrocredits: number;
  cachedPriceMicrocredits: number;
  legacyModelIds: string[];
  revisionId: string;
  revisionVersion: number;
  productSpec: CapabilitySpec;
  defaults: Record<string, unknown>;
  routes: CachedLogicalRoute[];
  archivedAt: number | null;
}

export interface RouteCatalogSnapshot {
  models: Map<string, CachedLogicalModel>;
  ordered: string[];
  loadedAt: number;
  catalogVersion: number;
}

/** 一次选路的完整结果：调用方不得替换其中任何供应侧字段 */
export interface RoutedModel {
  logicalModel: CachedLogicalModel;
  revisionId: string;
  revisionVersion: number;
  route: CachedLogicalRoute;
  channelModel: CachedChannelModel;
  capabilitySpec: CapabilitySpec;
  priceTier: CachedPriceTier | null;
  defaults: Record<string, unknown>;
  intent: ModelRequestIntent;
  /** 解析时读取的目录版本；账单 `priceVersion` 记录它，便于回溯「哪一版目录算出的价」 */
  catalogVersion: number;
}
