/**
 * 渠道与模型域的前端类型（P5）。
 *
 * 与 `types/api.d.ts` 分开放：那一份是旧接口的存量集合，本文件承载
 * `src/model/**` 新后端的契约。字段名与后端投影逐字一致，不做前端重命名 ——
 * 两边改名不同步是这类后台最难查的错（「图表有值、保存没生效」）。
 *
 * 金额一律是**微积分**（1 积分 = 1_000_000 微积分）的安全整数；JSON 不能传
 * BigInt，后端已转成 number，前端只在展示时换算。
 */

import type { PluginManifestFieldView } from "./model-admin";

/* ────────────────────────── 能力合同 ────────────────────────── */

/** 输入素材数量约束 */
export interface InputConstraintView {
  min: number;
  max: number;
}

/**
 * 选项约束：枚举或数值范围二选一。
 * `values: ['*']` 表示允许任意自定义值。
 */
export interface OptionConstraintView {
  values?: unknown[];
  min?: number;
  max?: number;
  step?: number;
}

export interface ImageSizePresetView {
  size: string;
  tier: string;
  ratio: string;
  width: number;
  height: number;
}

export interface ImageSizeView {
  /** `size`（像素口径）或 `aspect_ratio`（比例口径） */
  parameter: string;
  allowCustom: boolean;
  presets: ImageSizePresetView[];
}

/** 能力合同：线路与前台模型共用同一形状 */
export interface CapabilitySpecView {
  version: number;
  capability: string;
  operations?: string[];
  inputs?: Record<string, InputConstraintView>;
  options?: Record<string, OptionConstraintView>;
  imageSize?: ImageSizeView;
  imageParameters?: import('./imageCapability').ImageParameterDefinitionView[];
}

export interface CapabilityIssueView {
  kind: string;
  name: string;
  reason: string;
}

export interface CapabilityMatchView {
  matched: boolean;
  reasons: string[];
  issues: CapabilityIssueView[];
}

/* ────────────────────────── 渠道 ────────────────────────── */

export interface ChannelModelTagView {
  text: string;
  color: string;
}

export interface PublicChannelModelCostView {
  model: string;
  displayName: string;
  channelLabel: string;
  tags: ChannelModelTagView[];
  description: string;
  icon: string;
  capability: string;
  protocol: string;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
  capabilityConfig?: Record<string, unknown> | null;
}

/** 后台渠道投影；`apiKey` 恒为空串，只看 `hasApiKey` */
/**
 * 供应商默认商品配置。
 *
 * 新建商品与从上游同步时自动套用；只覆盖图像 / 文本（视频 / 音频参数
 * 组合差异太大，仍走逐条配置）。
 */
export interface AdminChannelDefaultModelView {
  capability: string;
  protocol: string;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
  enabled: boolean;
}

export interface AdminChannelView {
  id: string;
  userId: string;
  scope: string;
  enabled: boolean;
  name: string;
  sortOrder: number;
  baseUrl: string;
  apiKey: string;
  apiFormat: string;
  concurrencyLimit: number;
  proxyUrl: string;
  models: string[];
  modelCosts: PublicChannelModelCostView[];
  headers?: Array<{ name: string; value: string }>;
  /** 由「服务商目录」安装的渠道才有值；手工新建的渠道为空 */
  catalogProviderId?: string;
  hasApiKey: boolean;
  hasSecretKey: boolean;
  /** 供应商默认商品配置；未配置时为 null / undefined */
  defaultModel?: AdminChannelDefaultModelView | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 公开的系统渠道投影（`/channels/system` 的非管理员视角）。
 *
 * 与 `AdminChannelView` 的差别不是「字段少一点」，而是**内部拓扑被抹掉**：
 *   · `name` / `userId` / `catalogProviderId` 固定空 —— 渠道名会泄漏供应商与
 *     中转站身份，provider id 等于报出协议与厂商；
 *   · `baseUrl` 改写成中转入口 `/api/v1/ai/system/{id}`，`apiKey` 恒为 `'system'`
 *     （由服务端注入真实凭证）；
 *   · `concurrencyLimit` / `hasApiKey` / `hasSecretKey` 恒为 0 / false。
 *
 * 管理员走同一端点但拿到后台视角（真实名称与上游地址），凭证任何情况都不下发。
 */
export interface PublicChannelView {
  id: string;
  userId: string;
  scope: string;
  enabled: boolean;
  name: string;
  sortOrder: number;
  baseUrl: string;
  apiKey: string;
  apiFormat: string;
  concurrencyLimit: number;
  proxyUrl: string;
  models: string[];
  modelCosts: PublicChannelModelCostView[];
  headers?: Array<{ name: string; value: string }>;
  hasApiKey: boolean;
  hasSecretKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelPageResult {
  channels: AdminChannelView[];
  total: number;
  page: number;
  limit: number;
}

/**
 * 线路健康（一行 = 一条渠道模型）。
 *
 * 冷却来自服务端进程内快照：多实例部署时只反映当前实例看到的那部分，
 * 前端不做跨实例聚合。
 */
export interface ChannelHealthRowView {
  id: string;
  channelId: string;
  channelName: string;
  name: string;
  capability: string;
  enabled: boolean;
  protocolKnown: boolean;
  coolingUntil: string | null;
}

/** 单个观测窗口的线路健康指标 */
export interface ChannelModelHealthWindowView {
  /** 该窗口内的终态样本数（success + failed） */
  samples: number;
  success: number;
  failed: number;
  /** 成功率（0–1）；没有终态样本时为 null（「没数据」与「全失败」要分得开） */
  successRate: number | null;
  /** P95 耗时（毫秒）；没有终态样本时为 null */
  p95DurationMs: number | null;
  avgDurationMs: number | null;
  /** 是否因超过采样上限而只统计了最近的一部分 */
  sampled: boolean;
}

/** 最近一次终态调用样本 */
export interface ChannelModelHealthSampleView {
  status: string;
  statusCode: number;
  durationMs: number;
  errorCode: string;
  error: string;
  at: string;
}

/**
 * 一条线路（渠道模型）的健康指标。
 *
 * 与 `ChannelHealthRowView` 的分工：后者是**当前状态**（启停 / 协议 / 冷却），
 * 本类型是**历史表现**（成功率 / 耗时）。值班时两个都要看。
 */
export interface ChannelModelHealthRowView extends ChannelHealthRowView {
  windows: {
    day: ChannelModelHealthWindowView;
    week: ChannelModelHealthWindowView;
  };
  recent: ChannelModelHealthSampleView[];
  lastErrorCode: string;
}

/** 渠道 / 渠道模型的排序项 */
export interface ChannelOrderItemView {
  id: string;
  name: string;
  enabled: boolean;
}

/* ────────────────────────── 协议目录 ────────────────────────── */

/** 渠道模型表单的协议来源（能力匹配看 `capabilities`，不看协议名） */
export interface ProtocolCatalogEntryView {
  id: string;
  label: string;
  capabilities: string[];
  /** `generation` | `processing` */
  kind: string;
  /** 是否支持异步轮询 */
  async: boolean;
  /** 是否需要渠道同时配置 Secret Key */
  requiresSecretKey: boolean;
  source: 'registry' | 'manifest';
  pluginId: string;
  selectable: boolean;
  surfaces: string[];
  /** 协议声明的图片参数合同，作为渠道模型能力配置的默认值 */
  imageParameters: import('./imageCapability').ImageParameterDefinitionView[];
  /** 清单声明的默认 Base URL；空 = 需手工填写 */
  baseUrl: string;
  /** 鉴权类型（bearer / aws-sigv4 / ...） */
  authType: string;
  /** 主凭证字段名（通常是 apiKey） */
  credentialField: string;
  /** 副凭证字段名（如 secretKey）；空 = 不需要 */
  secretField: string;
  /** 插件清单声明的配置字段，用于渠道表单的 label / required */
  configuration: PluginManifestFieldView[];
}

/* ────────────────────────── 渠道模型 ────────────────────────── */

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

/** 售价字段（按计费方式取子集） */
export type ChannelModelSalePriceField =
  | 'unitPriceMicrocredits'
  | 'inputTokenPriceMicrocredits'
  | 'outputTokenPriceMicrocredits'
  | 'cachedTokenPriceMicrocredits';

/** 批量调价请求项：最终售价 + 乐观并发版本 */
export interface ChannelModelRepriceInput {
  modelId: string;
  priceVersion: number;
  priceTiers: Array<{
    id: string;
    priceVersion: number;
    prices: Partial<Record<ChannelModelSalePriceField, number>>;
  }>;
}

export interface AdminChannelModelView {
  id: string;
  channelId: string;
  modelKey: string;
  providerModelKey: string;
  displayName: string;
  channelLabel: string;
  tags: ChannelModelTagView[];
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
  capabilityConfig: Record<string, unknown> | null;
  priceTiers: ChannelModelPriceTierView[];
  createdAt: string;
  updatedAt: string;
}

/**
 * 跨渠道的渠道模型（`GET /admin/channel-models`）。
 *
 * 比 `AdminChannelModelView` 多两项：所属渠道名与渠道启停状态。
 * 渠道停用与模型停用是两件事 —— 模型 `enabled` 为真但渠道被停用时，
 * 这条线同样不进路由，两种状态要分得开显示。
 */
export interface AdminChannelModelListItem extends AdminChannelModelView {
  /** 所属渠道名 */
  channelName: string;
  /** 所属渠道是否启用 */
  channelEnabled: boolean;
}

/** 上游目录里的一条模型（只读预览） */
export interface UpstreamModelPreview {
  id: string;
  displayName?: string;
  /** `text` / `image` / `video` / `audio`，无法识别时为空 */
  modelType?: string;
  supportedEndpointTypes?: string[];
  supportsImages?: boolean;
  minImages?: number;
  maxImages?: number;
}

/** 上游目录导入结果：只写入管理员勾选且仍在上游目录里的模型 */
export interface ChannelModelFetchResultView {
  models: UpstreamModelPreview[];
  /** 本次新写入的渠道模型数量 */
  added: number;
  /** 其中已套用配置（本次统一配置或供应商默认配置）的数量 */
  configured: number;
}

/** 渠道模型连通性测试结果（与正式任务同一套协议 / 鉴权 / 出站策略） */
export interface ProtocolTestResultView {
  status: 'succeeded' | 'failed' | 'pending';
  providerStatus: string;
  durationMs: number;
  pollCount: number;
  taskId: string;
  mediaCount: number;
  text: string;
  message: string;
  errorCode: string;
  error: string;
  request: { method: string; path: string; contentType: string; model: string; protocol: string };
  result: { images: number; videos: number; audios: number; text: string };
  responsePreview: string;
  logId: string;
}

/** 导出文件（不含任何凭证） */
export interface SystemChannelExportView {
  format: string;
  version: number;
  exportedAt: string;
  channels: Array<{
    name: string;
    baseUrl: string;
    sortOrder: number;
    enabled: boolean;
    concurrencyLimit: number;
    catalogProviderId?: string;
    defaultModel?: AdminChannelDefaultModelView | null;
    models: Array<Record<string, unknown>>;
  }>;
}

export interface SystemChannelImportResultView {
  createdChannels: string[];
  updatedChannels: string[];
  savedModels: number;
  errors: string[];
}

/* ────────────────────────── 前台模型 ────────────────────────── */


/* ────────────────────────── 公开目录与报价 ────────────────────────── */

/** 报价（前台模型与渠道模型共用） */
export interface ModelQuoteView {
  logicalModelId: string;
  code: string;
  billingMode: string;
  quantity: number;
  amountMicrocredits: number | null;
  estimated: boolean;
  priceTierId: string;
  priceSelector: Record<string, string>;
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

/**
 * 构建意图的入参（三个目录端点共用）
 *
 * `capability` 是**模态**（`image` / `video` / `text`），不是产品能力 id
 * （`expand` / `main_image`）—— 两层命名空间不能混。
 *
 * 路由模拟端点允许省略：后端按模型自己的能力合同取模态。页面不应该
 * 替后端猜「这个产品能力对应哪个模态」，那正是命名空间容易踩坑的地方。
 */
export interface ModelIntentPayload {
  capability?: string;
  operation?: string;
  inputs?: Record<string, number>;
  options?: Record<string, unknown>;
}

// 按域拆分后的聚合出口
export type { PublicLogicalModelPriceTierView, AdminLogicalRouteView, AdminLogicalModelView, RouteDiagnosticsView, SimulateResultView, UserGroupModelOverrideView, UserGroupView, PluginManifestFieldView, PluginProviderView, PluginVerifyResultView, PluginView, PluginProtocolStatusView, PluginListResult, BillingOrderView, BillingBatchResolveResult, BillingOrderListResult, ApiLogView, ApiLogSummaryView, ApiLogListResult } from "./model-admin";
