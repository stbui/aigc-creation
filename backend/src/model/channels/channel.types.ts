/**
 * 渠道域的请求 / 响应类型 —— 与 open-ai-canvas 的管理端契约逐字段对齐。
 *
 * 价格一律以「微积分」的整数字符串或安全整数传输（`BigInt` 不能直接过 JSON），
 * 读写两侧都经过 `toSafeAmount()` / `toMicrocredits()` 校验。
 */

import type { ModelCapabilityConfig } from '../domain/capability-config';
import type { OutboundHeader } from '../infra/outbound';

export const CHANNEL_SCOPE_SYSTEM = 'system';
export const CHANNEL_SCOPE_USER = 'user';

export const PRICE_CURRENCY_CREDITS = 'credits';
export const PRICE_CURRENCY_USD = 'USD';
export const PRICE_CURRENCY_CNY = 'CNY';

export const USER_GROUP_BADGE_STYLES = ['none', 'vip', 'svip'] as const;
export const DEFAULT_USER_GROUP_CODE = 'default';

export const CHANNEL_MODEL_TAG_COLORS = ['purple', 'blue', 'green', 'gold', 'orange', 'pink'] as const;

/** 渠道并发上限 */
export const MIN_CHANNEL_CONCURRENCY = 1;
export const MAX_CHANNEL_CONCURRENCY = 999;
/** 排序值上限 */
export const MAX_SORT_ORDER = 999_999;
/** 单次批量删除渠道模型上限 */
export const MAX_CHANNEL_MODEL_BATCH_DELETE = 100;
/** 单次批量调价渠道模型上限（与参考实现一致） */
export const MAX_CHANNEL_MODEL_BATCH_REPRICE = 100;

export interface ChannelModelTag {
  text: string;
  color: string;
}

/** 渠道创建 / 更新入参（字段为 undefined 表示「未提交该字段」） */
export interface ChannelRequest {
  name?: string;
  sortOrder?: number | null;
  baseUrl?: string;
  apiKey?: string;
  secretKey?: string;
  concurrencyLimit?: number | null;
  useGlobalConcurrency?: boolean | null;
  models?: string[] | null;
  headers?: OutboundHeader[] | null;
  enabled?: boolean | null;
  /** 空串 = 显式清空渠道代理；undefined = 保持不变 */
  proxyUrl?: string | null;
}

export interface ChannelModelCostPricingRequest {
  configured?: boolean;
  unitPriceMicrocredits?: number | string;
  inputTokenPriceMicrocredits?: number | string;
  outputTokenPriceMicrocredits?: number | string;
  cachedTokenPriceMicrocredits?: number | string;
}

/** 价格档入参：一类规格对应一个上游 SKU 与一套售价 */
export interface ChannelModelPriceTierRequest {
  costPricing?: ChannelModelCostPricingRequest | null;
  selector?: Record<string, string> | null;
  resolution?: string | null;
  videoSeconds?: number | null;
  providerModelKey?: string;
  billingMode?: string;
  unitPriceMicrocredits?: number | string;
  inputTokenPriceMicrocredits?: number | string;
  outputTokenPriceMicrocredits?: number | string;
  cachedTokenPriceMicrocredits?: number | string;
  priceConfigured?: boolean;
  enabled?: boolean | null;
}

export interface ChannelModelRequest {
  modelKey?: string;
  providerModelKey?: string;
  displayName?: string;
  channelLabel?: string;
  tags?: ChannelModelTag[] | null;
  description?: string;
  icon?: string;
  capability?: string;
  protocol?: string;
  billingMode?: string;
  unitPriceMicrocredits?: number | string;
  inputTokenPriceMicrocredits?: number | string;
  outputTokenPriceMicrocredits?: number | string;
  cachedTokenPriceMicrocredits?: number | string;
  priceConfigured?: boolean;
  /** undefined = 保留已有计价货币（新建时为积分） */
  priceCurrency?: string | null;
  enabled?: boolean | null;
  capabilityConfig?: ModelCapabilityConfig | null;
  priceTiers?: ChannelModelPriceTierRequest[] | null;
}

/**
 * 批量调价入参。
 *
 * 前端按「售价 = 成本 × (1 + 加价率)」算出最终售价后提交，服务端只做校验与
 * 落库；`priceVersion` 是乐观并发令牌，任一模型或档位的版本已经变化就整批拒绝，
 * 避免两次批量改写互相覆盖。
 */
export interface ChannelModelRepriceRequest {
  modelId: string;
  priceVersion: number;
  priceTiers: ChannelModelTierRepriceRequest[];
}

export interface ChannelModelTierRepriceRequest {
  id: string;
  priceVersion: number;
  /** 只提交当前计费方式需要的字段，且必须提交全部字段 */
  prices: Record<string, number | string | null | undefined>;
}

/** 售价字段（按计费方式取子集） */
export type ChannelModelSalePriceField =
  | 'unitPriceMicrocredits'
  | 'inputTokenPriceMicrocredits'
  | 'outputTokenPriceMicrocredits'
  | 'cachedTokenPriceMicrocredits';

/* ───────────────────────── 响应投影 ───────────────────────── */

export interface PublicChannelModelCost {
  model: string;
  displayName: string;
  channelLabel: string;
  tags: ChannelModelTag[];
  description: string;
  icon: string;
  capability: string;
  protocol: string;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
  capabilityConfig?: ModelCapabilityConfig | null;
}

export interface PublicModelChannel {
  id: string;
  userId: string;
  scope: string;
  enabled: boolean;
  name: string;
  sortOrder: number;
  baseUrl: string;
  /** 后台投影永不含系统渠道密钥；仅保留是否已配置 */
  apiKey: string;
  apiFormat: string;
  concurrencyLimit: number;
  proxyUrl: string;
  models: string[];
  modelCosts: PublicChannelModelCost[];
  headers?: OutboundHeader[];
  hasApiKey: boolean;
  hasSecretKey: boolean;
  catalogProviderId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelModelPriceTierView {
  id: string;
  selector: Record<string, string>;
  resolution: string;
  videoSeconds: number;
  providerModelKey: string;
  billingMode: string;
  costPricing: {
    configured: boolean;
    unitPriceMicrocredits: number;
    inputTokenPriceMicrocredits: number;
    outputTokenPriceMicrocredits: number;
    cachedTokenPriceMicrocredits: number;
  };
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
  priceConfigured: boolean;
  enabled: boolean;
  priceVersion: number;
}

export interface ChannelModelView {
  id: string;
  channelId: string;
  modelKey: string;
  providerModelKey: string;
  displayName: string;
  channelLabel: string;
  tags: ChannelModelTag[];
  description: string;
  sortOrder: number;
  icon: string;
  capability: string;
  protocol: string;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
  priceConfigured: boolean;
  priceCurrency: string;
  enabled: boolean;
  priceVersion: number;
  capabilityVersion: number;
  capabilityConfig: ModelCapabilityConfig | null;
  priceTiers: ChannelModelPriceTierView[];
  createdAt: string;
  updatedAt: string;
}

/** 渠道 / 渠道模型的排序列表项 */
export interface ChannelOrderItem {
  id: string;
  name: string;
  enabled: boolean;
}

/** 导出文件（不含任何凭证） */
export interface SystemChannelExport {
  format: string;
  version: number;
  exportedAt: string;
  channels: SystemChannelExportChannel[];
}

export interface SystemChannelExportChannel {
  name: string;
  baseUrl: string;
  sortOrder: number;
  enabled: boolean;
  concurrencyLimit: number;
  catalogProviderId?: string;
  models: SystemChannelExportModel[];
}

export interface SystemChannelExportModel extends ChannelModelRequest {
  sortOrder: number;
}

export interface SystemChannelImportResult {
  createdChannels: string[];
  updatedChannels: string[];
  savedModels: number;
  errors: string[];
}

export const SYSTEM_CHANNEL_EXPORT_FORMAT = 'yingce.system-channels';
export const SYSTEM_CHANNEL_EXPORT_VERSION = 1;
export const MAX_IMPORTED_SYSTEM_CHANNELS = 200;
export const MAX_IMPORTED_CHANNEL_MODELS = 500;
