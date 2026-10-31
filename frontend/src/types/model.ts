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
  imageParameters?: Array<Record<string, unknown>>;
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
  /** 本次新写入、默认停用的渠道模型数量 */
  added: number;
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

export interface PublicLogicalModelPriceTierView {
  selector: Record<string, string>;
  resolution: string;
  videoSeconds: number;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
}

/** 后台线路：管理员要看到「这条线为什么不可用」 */
export interface AdminLogicalRouteView {
  id: string;
  channelModelId: string;
  channelId: string;
  channelName: string;
  channelModelKey: string;
  channelModelName: string;
  enabled: boolean;
  priority: number;
  weight: number;
  /** 线路启用 + 权重 > 0 + 渠道模型启用 + 渠道启用 */
  structurallyAvailable: boolean;
  /** 结构可用 + 计费方式可承接 + `channel` 策略下已配置价格档 */
  available: boolean;
  capabilitySpec: CapabilitySpecView;
}

export interface AdminLogicalModelView {
  id: string;
  code: string;
  name: string;
  icon: string;
  description: string;
  /** C 端能力 id */
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
  priceTiers: PublicLogicalModelPriceTierView[];
  legacyModelIds: string[];
  capabilitySpec: CapabilitySpecView;
  capabilityProfiles: CapabilitySpecView[];
  defaultOptions: Record<string, unknown>;
  available: boolean;
  enabled: boolean;
  activeRevisionId: string;
  revisionVersion: number;
  configurationError: string;
  availabilityError: string;
  archivedAt: string | null;
  routes: AdminLogicalRouteView[];
}

/** 线路诊断（路由模拟的逐行结果） */
export interface RouteDiagnosticsView {
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
  selectedTier: boolean;
}

export interface SimulateResultView {
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
  intent: Record<string, unknown>;
  defaults: Record<string, unknown>;
  productMatch: CapabilityMatchView;
  routes: RouteDiagnosticsView[];
  selectedRouteId: string;
  selectedPriceTierId: string;
  candidates: number;
  reason: string;
}

/* ────────────────────────── 用户分组 ────────────────────────── */

export interface UserGroupModelOverrideView {
  modelKey: string;
  ratioBasisPoints: number;
  pointsPerUsdMicrocredits: number;
  pointsPerCnyMicrocredits: number;
}

export interface UserGroupView {
  id: string;
  code: string;
  name: string;
  description: string;
  badgeLabel: string;
  badgeStyle: string;
  sortOrder: number;
  ratioBasisPoints: number;
  pointsPerUsdMicrocredits: number;
  pointsPerCnyMicrocredits: number;
  allChannels: boolean;
  channelIds: string[];
  modelOverrides: UserGroupModelOverrideView[];
  userCount: number;
  isDefault: boolean;
}

/* ────────────────────────── 插件 ────────────────────────── */

export interface PluginManifestFieldView {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
  secret?: boolean;
  default?: unknown;
  description?: string;
  values?: string[];
}

export interface PluginProviderView {
  id: string;
  label: string;
  kind: string;
  capabilities: string[];
  scopes: string[];
  registered: boolean;
}

export interface PluginVerifyResultView {
  ok: boolean;
  checkedAt: string;
  reason: string;
  providers: Array<{ id: string; ok: boolean; reason: string }>;
}

export interface PluginView {
  id: string;
  name: string;
  version: string;
  vendor: string;
  description: string;
  documentation: string;
  apiVersion: string;
  source: string;
  /** 包来源：内置（随代码入库）还是后台上传 */
  origin: 'builtin' | 'installed';
  /** 只有上传安装的包可卸载 */
  removable: boolean;
  installable: boolean;
  enabled: boolean;
  activeProtocols: number;
  runtime: { backend: string; web: string };
  surfaces: string[];
  permissions: string[];
  configuration: PluginManifestFieldView[];
  providers: PluginProviderView[];
  contributions: {
    providers: number;
    smsProviders: number;
    paymentProviders: number;
    workflows: number;
    canvasNodes: number;
    transforms: number;
    commands: number;
    assetSources: number;
    usageObservers: number;
    aiCapabilities: number;
    agents: number;
    importExport: number;
  };
  verify: PluginVerifyResultView | null;
  updatedAt: string | null;
  updatedBy: string;
}

export interface PluginProtocolStatusView {
  registered: number;
  hostBacked: number;
  skippedPlugins: string[];
  disabledPlugins: string[];
}

export interface PluginListResult {
  items: PluginView[];
  summary: {
    total: number;
    enabled: number;
    disabled: number;
    providers: number;
    capabilityStats: Record<string, number>;
    backendStats: Record<string, number>;
    protocol: PluginProtocolStatusView;
  };
}

/* ────────────────────────── 账单与调用记录 ────────────────────────── */

export interface BillingOrderView {
  id: string;
  userId: string;
  userEmail: string;
  taskId: string;
  model: string;
  capability: string;
  scene: string;
  billingMode: string;
  status: string;
  channelId: string;
  channelName: string;
  channelModelId: string;
  channelModelName: string;
  priceTierId: string;
  userGroup: string;
  priceCurrency: string;
  unitPriceMicrocredits: number;
  multiplierBasisPoints: number;
  quantity: number;
  amountMicrocredits: number;
  reservedAmountMicrocredits: number;
  actualAmountMicrocredits: number;
  refundedAmountMicrocredits: number;
  costConfigured: boolean;
  costAmountMicrocredits: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  usageSource: string;
  usageAvailable: boolean;
  chargeLimitSet: boolean;
  chargeLimitMicrocredits: number;
  providerRequestId: string;
  errorText: string;
  resolutionNote: string;
  resolvedBy: string;
  startedAt: string | null;
  settledAt: string | null;
  refundedAt: string | null;
  createdAt: string;
}

export interface BillingOrderListResult {
  items: BillingOrderView[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<string, number>;
}

export interface ApiLogView {
  id: string;
  userId: string;
  traceId: string;
  requestId: string;
  channelId: string;
  channelName: string;
  taskId: string;
  billingOrderId: string;
  source: string;
  capability: string;
  operation: string;
  requestKind: string;
  billable: boolean;
  apiFormat: string;
  method: string;
  path: string;
  model: string;
  status: string;
  statusCode: number;
  durationMs: number;
  pollCount: number;
  providerStatus: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  usageAvailable: boolean;
  mediaCount: number;
  videoSeconds: number;
  providerRequestId: string;
  estimatedCostMicros: number;
  costAvailable: boolean;
  currency: string;
  errorCode: string;
  error: string;
  createdAt: string;
}

export interface ApiLogSummaryView {
  total: number;
  success: number;
  failed: number;
  other: number;
  avgDurationMs: number;
}

export interface ApiLogListResult {
  items: ApiLogView[];
  total: number;
  page: number;
  pageSize: number;
  summary: ApiLogSummaryView;
}

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

/** 构建意图的入参（三个目录端点共用） */
export interface ModelIntentPayload {
  capability: string;
  operation?: string;
  inputs?: Record<string, number>;
  options?: Record<string, unknown>;
}
