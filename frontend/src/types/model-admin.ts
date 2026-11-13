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
  /**
   * 当前环境可用性。
   *
   * `available=false` 时 `reason` 必填且是人话说明（如「该插件声明了 `host:`
   * 宿主执行引擎，本环境未内置该引擎，协议不会注册」）—— 页面直接展示，
   * 不允许插件列在那里却不生效却没有任何交代。
   */
  availability: { available: boolean; reason: string };
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
  /** 声明了 `host:<engine>` 但本环境未内置该引擎的 provider（`pluginId:backend` 形式） */
  hostBacked: string[];
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
  resolvedBy: string; reviewable: boolean; reviewBatchId: string;
  /**
   * 退款归类。`route_switch` = 线路切换的内部重预留（钱没离开平台，
   * **不计入「已退」**）；其余为真实退款。
   */
  refundReason: string;
  startedAt: string | null;
  settledAt: string | null;
  refundedAt: string | null;
  createdAt: string;
}

export interface BillingBatchResolveResult {
  total: number;
  resolved: number;
  failed: number;
  results: Array<{ id: string; ok: boolean; error?: string }>;
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
  /**
   * 上游美元成本估算三列已废弃（恒为空）。
   *
   * 本仓的成本口径是**渠道模型价格档的成本价**（微积分），建单时随账单快照，
   * 在「账单」页按同一口径核算；调用记录不再下发这三列，避免出现「有这一列
   * 却恒为空」的误导。
   */
  errorCode: string;
  error: string;
  createdAt: string;
  /** 关联投影：用户昵称 / 账号 */
  userDisplayName?: string;
  userAccount?: string;
  /** 关联投影：任务状态 */
  taskStatus?: string;
  /** 关联投影：账单状态 */
  billingStatus?: string;
  /** 关联投影：账单预授权金额（微积分） */
  billingReservedMicrocredits?: number | null;
  /** 关联投影：账单实收金额（微积分） */
  billingSettledMicrocredits?: number | null;
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

