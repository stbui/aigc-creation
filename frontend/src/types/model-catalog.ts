/**
 * 公开目录与报价类型（`/models*` / `/model-catalog*`）。
 *
 * 从 `model.ts` 拆出，避免单文件继续膨胀；入口仍由 `types/model.ts` 统一
 * 转出，调用方不需要改 import。
 */

import type { ChannelModelTagView } from "./model";

/* ────────────────────────── 公开目录与报价 ────────────────────────── */

/** 报价（前台模型与渠道模型共用） */
export interface ModelQuoteView {
  capabilityId: string;
  modelKey: string;
  billingMode: string;
  quantity: number;
  amountMicrocredits: number | null;
  estimated: boolean;
  note: string;
}

export interface PublicCatalogPriceTierView {
  id: string;
  selector: Record<string, string>;
  resolution: string;
  videoSeconds: number;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
}

/** C 端渠道模型（脱敏；渠道名恒为空串） */
export interface PublicCatalogModelView {
  id: string;
  modelKey: string;
  channelLabel: string;
  tags: ChannelModelTagView[];
  description: string;
  displayName: string;
  sortOrder: number;
  icon: string;
  capability: string;
  protocol: string;
  capabilityConfig: Record<string, unknown> | null;
  defaultOptions: Record<string, unknown>;
  priceTiers: PublicCatalogPriceTierView[];
  pricingMode: string;
  displayPrice: number | null;
  priceLabel: string;
  available: boolean;
  /**
   * 可用性摘要（24h / 7d 成功率）。
   *
   * 此前目录只有 `available`（= 有有效价格档），C 端无法区分
   * 「这条线最近在挂」与「这条线只是没配价」。
   */
  availability: {
    /** 24 小时成功率（0–1）；无样本为 null */
    rate24h: number | null;
    sampleCount24h: number;
    /** 7 天成功率（0–1）；无样本为 null */
    rate7d: number | null;
    dataState: 'ok' | 'no_data';
  };
}

export interface PublicCatalogChannelView {
  id: string;
  name: string;
  displayName: string;
  sortOrder: number;
  models: PublicCatalogModelView[];
}

export interface PublicModelCatalogResult {
  source: 'system';
  /** 恒为空：模型在 `channels[].models` 内 */
  models: never[];
  channels: PublicCatalogChannelView[];
}

/* ────────────────────────── 财务分析 ────────────────────────── */

/** 分维度汇总（模型 / 渠道 / 能力 / 场景共用） */
export interface FinanceBreakdownRow {
  key: string;
  label: string;
  orders: number;
  settledOrders: number;
  refundedOrders: number;
  chargedMicrocredits: number;
  refundedMicrocredits: number;
  netMicrocredits: number;
}

export interface FinanceDayRow {
  date: string;
  orders: number;
  settledOrders: number;
  refundedOrders: number;
  chargedMicrocredits: number;
  refundedMicrocredits: number;
  netMicrocredits: number;
}

/**
 * 财务汇总。口径固定为：实收 = 已结算账单的实际金额；净收入 = 实收 - 已退；
 * 未结算（预留 / 运行 / 待核对）单列为挂账，不计入实收。
 */
export interface FinanceAnalyticsView {
  range: { from: string; to: string; days: number };
  totals: {
    orders: number;
    settledOrders: number;
    refundedOrders: number;
    uncertainOrders: number;
    outstandingMicrocredits: number;
    chargedMicrocredits: number;
    refundedMicrocredits: number;
    netMicrocredits: number;
    costMicrocredits: number;
    marginMicrocredits: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    settleRate: number;
  };
  statusCounts: Record<string, number>;
  byDay: FinanceDayRow[];
  byModel: FinanceBreakdownRow[];
  byChannel: FinanceBreakdownRow[];
  byCapability: FinanceBreakdownRow[];
  byScene: FinanceBreakdownRow[];
}

/* ────────────────────────── 服务商目录 ────────────────────────── */

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  vendor: string;
  description: string;
  version: string;
  apiFormat: string;
  baseUrl: string;
  protocols: string[];
  packageUrl: string;
  installed: boolean;
}

export interface ProviderCatalogView {
  source: string;
  configured: boolean;
  fetchedAt: string | null;
  reason: string;
  items: ProviderCatalogEntry[];
}

export interface ProviderVerifyResult {
  id: string;
  ok: boolean;
  reason: string;
}

