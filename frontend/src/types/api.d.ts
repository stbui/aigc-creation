/**
 * 能力标识。清单以后端 capability.registry 为准 (15 项), 前端不枚举 ——
 * 保留基础联合仅用于类型提示, 运行时以 CapabilityDef.id 为准。
 */
export type KnownCapability = 'main_image' | 'detail_image' | 'matting';
export type Capability = KnownCapability | (string & {});

/** 能力模式: real=本地真实算法 / mock=本地占位效果 / planned=尚未开放 */
export type CapabilityMode = 'real' | 'mock' | 'planned';
export type CapabilityGroupId = 'ecommerce_gen' | 'ai_retouch' | 'ai_video';
export type ParamType = 'enum' | 'number' | 'text' | 'boolean';

export interface ParamOption {
  value: string | number;
  label: string;
}

/** 参数声明: 工具页表单按此渲染, 新增能力无需改前端 */
export interface CapabilityParam {
  key: string;
  label: string;
  type: ParamType;
  default?: string | number | boolean;
  options?: ParamOption[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  help?: string;
}

export interface CapabilityDef {
  id: string;
  name: string;
  group: CapabilityGroupId;
  summary: string;
  sidebarHint?: string;
  badge?: string;
  mode: CapabilityMode;
  /**
   * 产出模态 (2026-10-20) —— 'image' | 'text' | 'video'。
   *
   * 与 mode **正交**: mode 说实现到什么程度 (real/mock/planned),
   * modality 说产出是什么。前端据此选 `<img>` 还是 `<video>` 渲染结果。
   */
  modality?: Modality;
  inputs: 0 | 1 | 2;
  inWorkbench: boolean;
  help?: string;
  params: CapabilityParam[];
  defaultParams: Record<string, unknown>;
  /**
   * 本次生成的积分消耗 (2026-10-20)。
   * 由后端按 SystemSetting 覆盖后的**运行时生效价**下发, 不是代码默认值 ——
   * 后台改价后前端无需改动即可显示新价。0 = 免费。
   */
  creditCost: number;
}

export interface CapabilityGroup {
  id: CapabilityGroupId;
  name: string;
  desc: string;
}

/** GET /api/v1/capabilities */
export interface CapabilitiesResponse {
  groups: CapabilityGroup[];
  items: CapabilityDef[];
  workbenchIds: string[];
}

/**
 * 提示词工具的返回 (AI润色 / 图片转提示词)。
 *
 * ⚠️ `source` 恒为 'gateway' —— 文本没有本地兜底, 通道不可用即报错,
 * 不编造模板文案。`model` 是渠道回报的实际模型名 (请求时填的可能只是别名)。
 */
export interface PromptToolResult {
  /** 产出的文本 */
  text: string;
  /** 来源标记 (恒为 gateway) */
  source: string;
  /** 渠道回报的实际模型名 */
  model?: string;
  /** 分词用量 */
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

/** POST /api/v1/mobile-upload/sessions —— 电脑端创建会话 */
export interface MobileUploadSessionCreated {
  sessionId: string;
  /** 手机端上传令牌 —— 需随二维码一起给到手机端 */
  token: string;
  /** 过期时间戳 (毫秒) */
  expiresAt: number;
  status: 'waiting' | 'received' | 'expired';
}

/** 手机上传接收到的单张素材 */
export interface MobileUploadAsset {
  id: string;
  /** 素材的可访问地址 —— 由后端给出 (前端不能从 assetId 推出存储 key) */
  url: string;
  /** 手机端原始文件名 */
  filename: string;
}

/** GET /api/v1/mobile-upload/sessions/:id —— 电脑端轮询 */
export interface MobileUploadSessionStatus {
  sessionId: string;
  status: 'waiting' | 'received' | 'expired';
  /**
   * 已接收的素材列表 (多图) —— **顺序即构图顺序**。
   * 参考站手机端可排序, 电脑端按此顺序回填参考图位。
   */
  assets: MobileUploadAsset[];
  /** 兼容字段: 第一张素材的 id */
  assetId: string | null;
  /** 兼容字段: 第一张素材的地址 */
  assetUrl: string | null;
  /** 兼容字段: 第一张素材的原始文件名 */
  originalFilename: string | null;
  expiresAt: number;
}

/** GET /api/v1/stats/overview */
export interface StatsOverview {
  totals: {
    tasks: number;
    succeeded: number;
    failed: number;
    running: number;
    assets: number;
    originals: number;
    generated: number;
    projects: number;
    successRate: number | null;
  };
  byCapability: Array<{
    capability: string;
    name: string;
    mode: string;
    total: number;
    succeeded: number;
    /** 该能力最近一次成功产出, 用作工作台卡片示例图 */
    thumbnailUrl: string | null;
  }>;
  last7Days: Array<{ date: string; count: number }>;
  recentTasks: Array<{
    id: string;
    capability: string;
    name: string;
    status: string;
    createdAt: string;
    thumbnailUrl: string | null;
  }>;
}

export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  /** 后台角色: 'user' | 'admin' | 'operator' | 'finance'。前端据此决定是否请求后台身份 */
  role?: string;
}

export interface AuthResponse {
  accessToken: string;
  user?: UserProfile;
}

export interface Project {
  id: string;
  name: string;
  createdAt?: string;
}

// 与后端 Prisma Asset 模型对齐 (backend/prisma/schema.prisma)
// 后端 src/assets/assets.service.ts createOriginal 返回完整 Asset 记录,
// 注意字段是 sourceUrl 而非 url。
export interface Asset {
  id: string;
  projectId: string;
  ownerId: string;
  kind: 'original' | 'generated' | string;
  capability?: Capability | null;
  sourceUrl: string;
  width?: number | null;
  height?: number | null;
  format: string;
  sizeBytes: number;
  createdAt: string;
}

export type AssetUploadResponse = Asset;

/** GET /api/v1/assets — 素材库列表 */
export interface AssetListResult {
  items: Asset[];
  total: number;
  limit: number;
  offset: number;
}

export interface GenerateRequest {
  projectId: string;
  capability: Capability;
  inputAssetIds: string[];
  params: Record<string, unknown>;
}

export interface GenerateResponse {
  taskId: string;
  id?: string;
}

// 后端 getTask 返回 outputAsset (backend/src/generate/generate.service.ts:125),
// listTasks 不返回 outputAsset。错误码字段是 errorCode 而非 error。
export interface Task {
  id: string;
  projectId: string;
  capability: Capability;
  status: TaskStatus;
  inputAssetIds?: string[];
  params?: Record<string, unknown>;
  provider?: string | null;
  errorCode?: string | null;
  /** 本次实际扣掉的积分快照。改价不影响已创建的任务 */
  creditCost?: number;
  createdAt?: string;
  updatedAt?: string;
  outputAsset?: Pick<
    Asset,
    'id' | 'sourceUrl' | 'capability' | 'width' | 'height' | 'format'
  > & {
    /**
     * 产出模态 (2026-10-20 视频通道落地) —— 前端据此选 `<img>` 还是 `<video>`。
     *
     * 后端按**产出的 mime** 推导, 而非查能力注册表: 产出形态是文件的真实
     * 形态, 不该由「当初打算产出什么」决定。
     */
    modality?: Modality;
    /** 视频时长 (毫秒); 仅视频产出有值 */
    durationMs?: number | null;
  } | null;
}

export type TaskListResult = Task[];

/* ────────────────────────────────────────────────────────────────
   后台管理端类型 (docs/admin-prd.md §3功能需求)
   端点均在 /api/v1/admin/* 下, 由 AdminGuard + PermissionGuard 双重校验。
   ──────────────────────────────────────────────────────────────── */

/** 后台角色。'user' 是 C 端用户, 无任何后台权限 */
export type AdminRole = 'admin' | 'operator' | 'finance';

/** 账号状态 */
export type UserStatus = 'active' | 'disabled' | 'deleted';

/** 能力模式 (与 C 端 CapabilityMode 同值, 后台复用同一 registry) */
export type AdminCapabilityMode = CapabilityMode;

/** GET /api/v1/admin/me — 当前后台用户 */
export interface AdminMe {
  id: string;
  email: string;
  role: AdminRole;
  roleLabel: string;
  /** 已授予的权限点, 如 'user.write'。前端 can() 的唯一依据 */
  permissions: string[];
  /** 需输入操作原因的高危权限点 */
  highRiskPermissions: string[];
}

/** GET /api/v1/admin/permissions — 权限点全集与内置角色 */
export interface AdminPermissionCatalog {
  permissions: string[];
  highRiskPermissions: string[];
  roles: Array<{ code: AdminRole; label: string; permissions: string[] }>;
}

/** GET /api/v1/admin/overview — 平台概览 */
export interface AdminOverview {
  /** 统计窗口天数 (7 | 30 | 90) */
  days: number;
  totals: {
    users: number;
    newUsers: number;
    projects: number;
    tasks: number;
    succeeded: number;
    failed: number;
    running: number;
    pending: number;
    /** 百分比, 无已完成任务时为 null (不是 0 —— 0 表示"全部失败") */
    successRate: number | null;
    assets: number;
    originals: number;
    generated: number;
  };
  /** 按日聚合并补齐无数据日, 天数与 days 一致 */
  trend: Array<{ date: string; total: number; succeeded: number; failed: number }>;
  recentTasks: Array<{
    id: string;
    capability: string;
    /** 来自 capability.registry, 未知能力回退为 id */
    capabilityName: string;
    mode: string;
    status: TaskStatus;
    provider: string | null;
    errorCode: string | null;
    createdAt: string;
    durationMs: number;
    thumbnailUrl: string | null;
  }>;
}

/* ────────────────────────────────────────────────────────────────
   后台: 用户与账户 / 角色权限 / 系统设置 / 审计
   ──────────────────────────────────────────────────────────────── */

/** GET /api/v1/admin/users */
export interface AdminUserListResult {
  items: Array<{
    id: string;
    email: string;
    name: string;
    role: AdminRole | 'user';
    roleLabel: string;
    status: UserStatus;
    statusLabel: string;
    createdAt: string;
    lastLoginAt: string | null;
    projectCount: number;
    taskCount: number;
    assetCount: number;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

/** GET /api/v1/admin/users/:id */
export interface AdminUserDetail {
  id: string;
  email: string;
  name: string;
  role: AdminRole | 'user';
  roleLabel: string;
  status: UserStatus;
  statusLabel: string;
  createdAt: string;
  lastLoginAt: string | null;
  stats: {
    projects: number;
    tasks: number;
    assets: number;
    taskStatus: { succeeded: number; failed: number; running: number; pending: number };
  };
  recentTasks: Array<{
    id: string;
    capability: string;
    capabilityName: string;
    mode: string;
    status: TaskStatus;
    createdAt: string;
    thumbnailUrl: string | null;
  }>;
  recentAssets: Array<{
    id: string;
    sourceUrl: string;
    kind: string;
    width: number | null;
    height: number | null;
  }>;
}

/** GET /api/v1/admin/users/:id/impact */
export interface AdminUserImpact {
  email: string;
  projects: number;
  tasks: number;
  assets: number;
}

/** POST /api/v1/admin/users/:id/password */
export interface AdminPasswordReset {
  id: string;
  email: string;
  /** 明文仅此一次返回, 不入库不入审计 */
  tempPassword: string;
  notice: string;
}

/** GET /api/v1/admin/roles */
export interface AdminRoleItem {
  code: AdminRole;
  label: string;
  builtIn: boolean;
  /** 库里的实际生效值, 而非代码默认值 */
  permissions: string[];
}

/** 系统设置的可写字段 (扁平, 与后端 UpdateSettingsDto 一致) */
export type AdminSettingField =
  | 'siteName'
  | 'siteMaintenance'
  | 'uploadMaxSizeMb'
  | 'uploadAllowedTypes'
  | 'generateMaxConcurrent'
  | 'generatePollIntervalMs'
  | 'generateMaxPolls'
  | 'securitySessionTtlDays'
  | 'securityPasswordMinLength';

/** GET /api/v1/admin/settings */
export interface AdminSettings {
  groups: Array<{
    key: string;
    label: string;
    items: Array<{
      key: AdminSettingField;
      label: string;
      description: string;
      type: 'string' | 'number' | 'boolean';
      value: string | number | boolean;
      default: string | number | boolean;
      min?: number;
      max?: number;
      overridden: boolean;
      group: string;
    }>;
  }>;
}

/** GET /api/v1/admin/audit-logs */
export interface AdminAuditListResult {
  items: Array<{
    id: string;
    createdAt: string;
    actorId: string;
    actorEmail: string;
    actorName: string;
    actorRole: string;
    action: string;
    targetType: string;
    targetId: string;
    detail: Record<string, unknown>;
    reason: string | null;
    ip: string;
    success: boolean;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

/* ────────────────────────────────────────────────────────────────
   模型配置与调用记录 (2026-10-20)
   ──────────────────────────────────────────────────────────────── */

/** 配置项的实际来源: env 优先级最高, 其次后台写入, 最后代码默认值 */
export type ConfigSource = 'env' | 'db' | 'default';

/**
 * 模态 —— 2026-10-20 起配置与路由的一等维度。
 *
 * 厂商与模态是多对多 (优云智算有图无文, DeepSeek 有文无图),
 * 故任何按厂商推断模态的写法都是错的, 必须显式声明。
 */
export type Modality = 'text' | 'image' | 'video';

export interface AdminModelConfigItem {
  key: string;
  label: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'secret';
  group: string;
  /** 该项所属模态; null 表示跨模态共用 (如素材对外基址) */
  modality: Modality | null;
  /** 对应的环境变量名; 存在且非空时会覆盖后台写入值 */
  envName: string | null;
  /**
   * 存量键名 (2026-10-20 模态拆分遗留)。
   * 非空说明当前生效值读自改造前的旧单前缀键 —— 界面上应提示
   * 「读的是存量配置」, 否则运营改了新键却看不到变化会以为坏了。
   */
  legacyKey: string | null;
  secret: boolean;
  default: string | number | boolean;
  /** 生效值; secret 类恒为 null (只给 hasValue/masked) */
  value: string | number | boolean | null;
  hasValue: boolean;
  /** 凭据脱敏值, 如 sk-a****3456 */
  masked: string | null;
  source: ConfigSource;
  overridden: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * 通道协议。
 *
 * ⚠️ 协议名**跨模态复用**: openai 在文生图是 images/generations,
 * 在文生文是 chat/completions, 端点完全不同。故任何按协议名反推用途的
 * 写法都是错的 —— 必须与 modality 组合使用。
 */
export type GatewayProtocol =
  | 'aigc'
  | 'openai'
  | 'volcengine'
  | 'minimax'
  | 'openai-chat'
  | 'aigc-video'
  | 'openai-video'
  | (string & {});

/** 尺寸参数的表达方式 —— 各家对「多大」的写法完全不同 */
export type SizeStyle = 'openai-wh' | 'volc-tier' | 'ratio-only';

/**
 * 内置厂商预设 (后端 provider-presets.ts 单一声明)。
 *
 * 用途: 后台「模型配置」页选厂商后自动填好 基址/协议/模型 三项 ——
 * 手填这三项最容易错, 而配错的表现是**静默回落本地占位图**, 界面上看不出来。
 *
 * sizeStyle / sizeField / maxRefImages / refStyle 现为可选: 文生文无这些概念。
 */
export interface VendorPreset {
  key: string;
  /**
   * 所属厂商的标识 —— 同一家厂商跨模态共享基址与凭据。
   * 后台选厂商时据此联动填充各模态。
   */
  vendorKey: string;
  label: string;
  /** 该预设服务哪个模态 */
  modality: Modality;
  protocol: GatewayProtocol;
  /** 一律存到厂商根域 (不含 /v1); /v1 由后端 provider 统一补 */
  baseUrl: string;
  models: Array<{ id: string; label: string; note?: string }>;
  sizeStyle?: SizeStyle;
  /** 尺寸字段实际名, 如 "size（档位）" / "aspect_ratio" */
  sizeField?: string;
  maxRefImages?: number;
  refStyle?: 'base64' | 'url';
  /** 拿 token 的控制台地址 */
  consoleUrl: string;
  note?: string;
}

export interface ProtocolOption {
  value: GatewayProtocol;
  label: string;
  desc: string;
}

/** 单个模态的通道快照 */
export interface AdminModelChannel {
  modality: Modality;
  label: string;
  desc: string;
  enabled: boolean;
  /** 基址已脱敏 (路径替换为 /***) */
  baseUrl: string;
  model: string;
  provider: string;
  /** 该 (模态, 协议) 组合本项目是否已有实现; false 说明配了也必然失败 */
  protocolKnown: boolean;
  /**
   * 当前选中的厂商预设 key (2026-10-20 通道总览卡片用)。
   * 空串 = 未选厂商预设 (按各字段手填)。
   */
  vendor: string;
  /** 当前厂商的可读名; 未匹配到预设时为空串 */
  vendorLabel: string;
  timeoutMs: number;
  pollMs: number;
  maxPolls: number;
  assetBase: string;
  /**
   * 通道实际生效态 —— **三态** (2026-10-20)。
   *
   * ⚠️ 此前只有 gateway/local 两态, 未配网关一律记 local。但**视频与文本
   * 没有本地兜底** —— 标成 local 会在后台显示「本地算法」, 而实际调用会
   * 直接失败。那等于谎报可用性 (与「不把本地伪装成模型」是同一类错误的
   * 反向版本)。故拆出第三态 `none`。
   */
  effective: 'gateway' | 'local' | 'none';
  /** 该模态可选的厂商预设 */
  vendors: VendorPreset[];
  /** 该模态可选的协议; video 首批为空数组 = 尚未取证任何一家 */
  protocolOptions: ProtocolOption[];
  /** 配了通道但协议未接入 —— 必须显式警告, 不能静默 */
  configuredButUnsupported: boolean;
}

/**
 * 厂商联动填充方案 (2026-10-20 厂商聚合后新增)。
 *
 * 厂商聚合后, 同一家的多个模态共享基址与凭据。但配置项仍按模态分开
 * (存量键不改名), 故由后端给出「选这家厂商 → 各模态该填什么」,
 * 前端一次填完, 免得运营在三个模态里手动填同一个基址。
 */
export interface AdminVendorFillPlan {
  vendorKey: string;
  label: string;
  /** 各模态的填充项 (只有该厂商支持的模态才有) */
  fills: Array<{
    modality: Modality;
    baseUrl: string;
    provider: string;
    model: string;
    vendorPresetKey: string;
  }>;
  /** 该厂商涉及的模态 */
  modalities: Modality[];
}

export interface AdminModelConfig {
  groups: Array<{
    key: string;
    label: string;
    desc: string;
    items: AdminModelConfigItem[];
  }>;
  /** 逐模态通道快照 —— 页面分栏渲染的主数据源 */
  channels: Record<Modality, AdminModelChannel>;
  modalities: Array<{ value: Modality; label: string; desc: string }>;
  /**
   * @deprecated 恒等于 channels.image。保留是为让改造前的存量前端与外部脚本
   * 继续读到 shape 不变的数据; 新代码请一律走 channels[modality]。
   */
  channel: {
    enabled: boolean;
    /** 基址已脱敏 (路径替换为 /***) */
    baseUrl: string;
    model: string;
    /** 当前通道协议 (openai / volcengine / minimax / aigc) */
    provider: string;
    /** 该协议是否在本项目已实现生图; false 说明配了也会 404 回落 */
    protocolKnown: boolean;
    timeoutMs: number;
    pollMs: number;
    maxPolls: number;
    assetBase: string;
    /**
     * 当前整体生效通道 —— 三态。
     * gateway=真实模型 / local=本地算法 / none=未接入且无兜底（会失败）。
     */
    effective: 'gateway' | 'local' | 'none';
  };
  /** @deprecated 用 channels[modality].vendors */
  vendors: VendorPreset[];
  /** @deprecated 用 channels[modality].protocolOptions */
  protocolOptions: ProtocolOption[];
  routes: AdminModelRouteRow[];
}

/** 逐能力路由总览的一行 (2026-10-20 抽出为具名类型, 供组件复用) */
export interface AdminModelRouteRow {
    capability: string;
    name: string;
    /** 能力自身的模式: real=已接入 / mock=占位 */
    mode: string;
    /** 该能力产出什么模态 (与 mode 正交) */
    modality: Modality;
    route: 'auto' | 'local' | 'remote';
    /**
     * 实际生效态 —— **三态** (2026-10-20)。
     *
     * ⚠️ 此前只有 gateway/local, 未配网关一律 local。但视频/文本**无本地兜底** ——
     * 标 local 等于谎报「会回落本地」, 实际是直接失败。
     */
    effective: 'gateway' | 'local' | 'none';
}

export interface AdminModelCall {
  id: string;
  createdAt: string;
  capability: string;
  taskId: string | null;
  route: string;
  source: 'gateway' | 'local';
  fallback: boolean;
  reason: string | null;
  model: string | null;
  prompt: string | null;
  durationMs: number;
  success: boolean;
  outputBytes: number;
  width: number | null;
  height: number | null;
  errorCode: string | null;
}

export interface AdminModelCallListResult {
  result: {
    items: AdminModelCall[];
    total: number;
    page: number;
    pageSize: number;
  };
  stats: {
    total: number;
    gatewayCount: number;
    localCount: number;
    successCount: number;
    fallbackCount: number;
    avgDurationMs: number;
    /** 仅 gateway 通道的平均耗时 (与本地混算无意义) */
    gatewayAvgDurationMs: number;
  };
  capabilities: Array<{ capability: string; count: number }>;
  sources: Array<{ source: string; count: number }>;
}

export interface AdminModelConfigTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  detail?: string;
}

/**
 * 批量连通性测试结果 (2026-10-20)。
 *
 * 每个模态一个结果 —— 某模态失败**不影响**其它模态的结果返回
 * (批量测试的目的就是「一次看全」)。
 */
export interface AdminModelConfigTestAllResult {
  /** 按模态索引: 'text' | 'image' | 'video' */
  results: Record<string, AdminModelConfigTestResult>;
  /** 通过的模态数 */
  okCount: number;
  /** 总模态数 */
  total: number;
  /** 批量测试总耗时 (毫秒) —— 并发执行, 约等于最慢的那一个 */
  elapsedMs: number;
}

/* ────────────────────────────────────────────────────────────────
   交易域: 商品 / 订单 / 积分 (commerce-design.md)
   ──────────────────────────────────────────────────────────────── */

/** 在售商品 (SKU)。金额一律整数分, 由展示层除 100 格式化 */
export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCents: number;
  /** 划线价, 仅展示不参与计算 */
  originalPriceCents: number | null;
  credits: number;
  /** 0 = 永久有效 */
  creditsValidDays: number;
  type: string;
  /** priceCents === 0。展示「免费领取」而非 ¥0.00 */
  isFree: boolean;
}

/** GET /api/v1/products (公开免登录) */
export type ProductsResponse = Product[];

/** 订单状态机 (后端 order.service.ts TRANSITIONS, 不可跳跃) */
export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'refunded' | 'partial_refunded';

export interface OrderItemView {
  id: string;
  productId: string;
  sku: string;
  name: string;
  priceCents: number;
  credits: number;
  validDays: number;
  quantity: number;
}

export interface PaymentView {
  id: string;
  payTransactionId: string;
  channel: string;
  amountCents: number;
  status: string;
  message: string | null;
  /** 沙箱演示场景标记, 真实通道为 null */
  sandboxScenario: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface RefundView {
  id: string;
  amountCents: number;
  /** 实际扣回的积分 */
  creditsReclaimed: number;
  /** 已消耗、无法追回的积分。必须如实展示, 不能吞掉 */
  creditsUnreclaimable: number;
  reason: string;
  createdAt: string;
}

export interface Order {
  id: string;
  orderNo: string;
  status: OrderStatus;
  totalCents: number;
  discountCents: number;
  /** 实付 (优惠后)。历史订单无此值时后端回落原价 */
  paidCents: number;
  refundedCents: number;
  grantedCredits: number;
  couponCode: string | null;
  /** 券不可用的原因。降级为不打折而非阻断下单 */
  couponWarning: string | null;
  paidAt: string | null;
  expiresAt: string;
  createdAt: string;
  items: OrderItemView[];
  payments: PaymentView[];
  refunds: RefundView[];
  /** 幂等下单命中: true = 复用了既有订单, 未重复建单 */
  idempotentHit?: boolean;
}

/** 积分余额总览。余额由批次汇总推导, 不存冗余字段 */
export interface CreditBalance {
  balance: number;
  /** 30 天内到期的剩余积分 */
  expiringSoon: number;
  totalEarned: number;
  totalConsumed: number;
  activeLots: number;
  nearestExpiry: string | null;
}

export interface CreditLot {
  id: string;
  source: string;
  orderId: string | null;
  totalCredits: number;
  remainingCredits: number;
  expireAt: string | null;
  createdAt: string;
  status: 'active' | 'expired' | 'exhausted';
}

export interface CreditLedgerEntry {
  id: string;
  type: string;
  /** 有符号: 正为获得, 负为消耗 */
  amount: number;
  balanceAfter: number;
  lotId: string | null;
  orderId: string | null;
  taskId: string | null;
  reason: string | null;
  createdAt: string;
}

/** 能力消耗价一行 (后台改价用) */
export interface AdminCreditPrice {
  capabilityId: string;
  capabilityName: string;
  /** 运行时生效价 */
  cost: number;
  /** setting = 后台覆盖中; registry = 用代码默认值 */
  source: 'setting' | 'registry';
  overridden: boolean;
  /** 代码默认值, 供「回落」时对照 */
  registryDefault: number;
}

/** 沙箱支付结果 */
export interface SandboxPayResult {
  order: Order;
  idempotentHit: boolean;
  message: string;
}

/** 会员套餐。权益文案由后端生成 (buildPerkLabels), 前端不自行拼 */
export interface MembershipPlan {
  id: string;
  code: string;
  name: string;
  description: string;
  priceCents: number;
  priceYuan: string;
  durationDays: number;
  /** 每月发放的订阅积分 */
  monthlyCredits: number;
  perks: {
    fastChannel: boolean;
    /** 同时进行中任务上限; 0 = 不限 */
    maxConcurrent: number;
    /** 加油包折扣万分比。9500 = 95 折 */
    addonDiscountBps: number;
  };
  /** 后端生成的可读权益文案 */
  perkLabels: string[];
}

export interface MyMembership {
  isMember: boolean;
  planCode: string;
  planName: string;
  perks: MembershipPlan['perks'];
  expiresAt: string | null;
  monthlyCredits: number;
  totalSavedCents: number;
  totalSavedYuan: string;
  discountedOrders: number;
  history: Array<{
    id: string;
    planCode: string;
    planName: string;
    status: string;
    startAt: string;
    expiresAt: string;
    monthlyCredits: number;
  }>;
}

/* ────────────────────────────────────────────────────────────────
   任务监控 (admin-prd.md §3.5 B-28~B-33)
   ──────────────────────────────────────────────────────────────── */

/** 列表行。字段与后端 tasks-admin.service list() 返回一一对应 */
export interface AdminTask {
  id: string;
  capability: string;
  capabilityName: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  /** 实际通道: gateway=真实模型 / local=本地算法 / mock=尚未跑完的初值 */
  provider: string | null;
  errorCode: string | null;
  creditCost: number;
  /** 由哪个失败任务重试而来 (null = 用户首次发起) */
  retriedFromId: string | null;
  user: { id: string; email: string };
  project: { id: string; name: string };
  /** updatedAt - createdAt; running 任务的该值仍在增长 */
  durationMs: number;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl: string | null;
}

/** 拥堵指标。刻意不受列表筛选影响 —— 它的用途是回答"系统现在堵不堵" */
export interface AdminTaskCongestion {
  pending: number;
  running: number;
  failedLastHour: number;
  runningThreshold: number;
}

export interface AdminTaskListResult {
  result: {
    items: AdminTask[];
    total: number;
    page: number;
    pageSize: number;
  };
  congestion: AdminTaskCongestion;
  capabilities: Array<{ capability: string; count: number }>;
  providers: Array<{ provider: string; count: number }>;
}

/** 任务详情 */
export interface AdminTaskDetail {
  id: string;
  capability: string;
  capabilityName: string;
  status: AdminTask['status'];
  provider: string | null;
  errorCode: string | null;
  creditCost: number;
  retriedFromId: string | null;
  user: { id: string; email: string };
  project: { id: string; name: string };
  durationMs: number;
  createdAt: string;
  updatedAt: string;
  /**
   * 状态流转节点。
   *
   * ⚠ `at` 可为 null: GenerationTask 未落 startedAt, 「开始执行」时刻
   * 无法还原, 故不编造中间节点 (见后端 detail() 注释)。
   */
  timeline: Array<{ key: string; label: string; at: string | null; done: boolean }>;
  params: Record<string, unknown>;
  /** 输入素材, 已按 inputAssetIds 原序排列 (多图能力依赖顺序语义) */
  inputAssets: Array<{
    id: string;
    sourceUrl: string;
    width: number | null;
    height: number | null;
    kind: string;
  }>;
  outputAsset: {
    id: string;
    sourceUrl: string;
    width: number | null;
    height: number | null;
    format: string;
    sizeBytes: number;
  } | null;
}

/* ────────────────────────────────────────────────────────────────
   数据备份 (admin-prd.md §3.19 B-96~B-101)
   ──────────────────────────────────────────────────────────────── */

/** GET /api/v1/admin/backups */
export interface AdminBackup {
  id: string;
  filename: string;
  sizeBytes: number;
  /** SHA-256 十六进制, 64 位 */
  sha256: string;
  trigger: 'manual' | 'scheduled';
  status: 'pending' | 'succeeded' | 'failed';
  errorMessage: string | null;
  sourceSizeBytes: number | null;
  /** B-97: 无验证记录的备份视为无效 */
  verified: boolean;
  verifiedAt: string | null;
  verifyReport: string | null;
  verifyWarnings: string | null;
  createdAt: string;
}

/** GET /api/v1/admin/backups/stats */
export interface AdminBackupStats {
  total: number;
  succeeded: number;
  verified: number;
  /** 未验证份数 —— 需提醒运维尽快验证 */
  unverified: number;
  failed: number;
  totalBytes: number;
  totalMb: number;
  lastSuccessAt: string | null;
  /** 超过 24 小时无成功备份即视为异常 */
  stale: boolean;
}

/** GET /api/v1/admin/backups/cleanup-logs */
export interface AdminCleanupLog {
  id: string;
  target: string;
  deletedCount: number;
  retentionDays: number;
  trigger: 'manual' | 'scheduled';
  skippedCount: number;
  detail: string;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

/* ────────────────────────────────────────────────────────────────
   素材管理 + 存储后端 (admin-prd.md §3.4 B-21~27 / §3.11 B-62/63)
   ──────────────────────────────────────────────────────────────── */

/** 存储后端标识 */
export type StorageBackendId = 'local' | 'oss' | 'minio';

/** 素材上架状态。hidden = 已下架, 用户端不可见但记录与文件保留 */
export type AssetStatus = 'visible' | 'hidden';

/** GET /api/v1/admin/assets */
export interface AdminAssetListResult {
  items: Array<{
    id: string;
    kind: 'original' | 'generated';
    capability: string | null;
    width: number | null;
    height: number | null;
    format: string;
    sizeBytes: number;
    status: AssetStatus;
    /** 可访问 URL。本地为 /uploads/key, 云端为签名 URL(会过期, 不入库) */
    sourceUrl: string;
    /** 写入时的后端 —— 切换默认后端后老素材仍从这里读 */
    storageBackend: StorageBackendId;
    /** 存储内相对 key, 唯一真相, 不含域名 */
    storageKey: string | null;
    ownerId: string;
    ownerEmail: string;
    projectId: string;
    projectName: string;
    createdAt: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

/** GET /api/v1/admin/assets/stats */
export interface AdminAssetStats {
  total: number;
  totalBytes: number;
  totalMb: number;
  byStatus: Record<string, number>;
  byBackend: Record<string, number>;
  byKind: Record<string, number>;
}

/** GET /api/v1/admin/projects */
export interface AdminProjectListResult {
  items: Array<{
    id: string;
    name: string;
    ownerId: string;
    ownerEmail: string;
    ownerName: string;
    assetCount: number;
    taskCount: number;
    createdAt: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

/** GET /api/v1/admin/storage/status */
export interface AdminStorageStatus {
  active: StorageBackendId;
  backends: Array<{
    backend: StorageBackendId;
    available: boolean;
    configured: boolean;
    active: boolean;
    /** 脱敏凭据, 永不返回明文 (B-63) */
    masked?: string;
    endpoint?: string;
    probeMessage?: string;
    probeLatencyMs?: number;
  }>;
  credentialSource: string;
  /** PRD 约束: 凭据走环境变量, 界面不可编辑 */
  editable: false;
}

/* ────────────────────────────────────────────────────────────────
   营销中心 (admin-prd.md §3.12 B-64~B67 / M11)
   ──────────────────────────────────────────────────────────────── */

/** 券类型: full_cut 满减 | discount 折扣 | fixed 固定额 */
export type CouponType = 'full_cut' | 'discount' | 'fixed';
/** 券适用范围: all 全站 | product 指定商品 | new_user 仅新用户首单 */
export type CouponScope = 'all' | 'product' | 'new_user';
export type CouponStatus = 'on' | 'off';
export type CampaignType = 'limited_price' | 'limited_free' | 'popup';
export type CampaignStatus = 'draft' | 'active' | 'ended' | 'off';

/** GET /api/v1/admin/coupons */
export interface AdminCoupon {
  id: string;
  code: string;
  name: string;
  type: CouponType;
  /** 语义随 type: full_cut/fixed 为减免分; discount 为折扣万分比 (8500 = 85折) */
  value: number;
  thresholdCents: number;
  scope: CouponScope;
  productIds: string[];
  /** 0 = 不限量 */
  totalCount: number;
  usedCount: number;
  /** 0 = 不限 */
  perUserLimit: number;
  validFrom: string;
  validTo: string;
  /** 人工设置的两态开关 (写入用同一字段) */
  status: CouponStatus;
  createdAt: string;
  /* ── 后端派生字段 (marketing.service.ts toCouponView) ────────────── */
  /** 展示用面额: 折扣转「8.5 折」, 其余为「¥10.00」 */
  valueLabel: string;
  /** 「满 100.00 元可用」或「无门槛」 */
  thresholdLabel: string;
  typeLabel: string;
  scopeLabel: string;
  /** 剩余可核销数量。null = 不限量 */
  remaining: number | null;
  /**
   * 五态生效判定, **优先于 status 展示**。
   * 拆成两个字段是因为读语义与写语义不同: status 是人工开关,
   * effective 是含时间窗与限量的派生结果。把过期显示成「已停用」会让运营
   * 去找不存在的误操作 —— 过期是自然结果, 停用是人为决定, 处置完全不同。
   */
  effective: 'on' | 'off' | 'expired' | 'not_started' | 'sold_out';
  updatedAt: string;
}

/** POST/PATCH /api/v1/admin/coupons */
export interface UpsertCouponPayload {
  /** 创建必填; 更新留空表示不改 (改券码等于让已发出的券集体失效) */
  code?: string;
  name: string;
  type: CouponType;
  value: number;
  thresholdCents?: number;
  scope?: CouponScope;
  productIds?: string[];
  totalCount?: number;
  perUserLimit?: number;
  validFrom?: string;
  validTo?: string;
  status?: CouponStatus;
}

/** GET /api/v1/admin/campaigns */
export interface AdminCampaign {
  id: string;
  name: string;
  type: CampaignType;
  payload: {
    productId?: string;
    priceCents?: number;
    capabilityIds?: string[];
    title?: string;
    body?: string;
    ctaText?: string;
    ctaUrl?: string;
  };
  startAt: string;
  endAt: string;
  /** 人工设置的状态 */
  status: CampaignStatus;
  statusLabel: string;
  /**
   * 派生生效态, **优先于 status 展示**。
   * status='active' 但时间窗未到时对用户就是不生效, 混为一谈会让运营
   * 以为活动已在跑而实际没有曝光。
   */
  effective: 'draft' | 'live' | 'scheduled' | 'ended' | 'off';
  audience: { onlyNewUsers?: boolean };
  createdAt: string;
  updatedAt: string;
}

export interface UpsertCampaignPayload {
  name: string;
  type: CampaignType;
  payload?: AdminCampaign['payload'];
  startAt: string;
  endAt: string;
  status?: CampaignStatus;
  onlyNewUsers?: boolean;
}

/** GET /api/v1/admin/invites */
export interface AdminInviteListResult {
  items: Array<{
    id: string;
    inviteCode: string;
    inviterEmail: string;
    inviterName: string;
    inviteeEmail: string;
    inviteeName: string;
    boundAt: string;
    rewardStatus: 'pending' | 'granted' | 'rejected';
  }>;
  total: number;
  page: number;
  pageSize: number;
  summary: {
    pending: number;
    granted: number;
  };
}

/** GET /api/v1/admin/checkin (签到记录) */
export interface AdminCheckinListResult {
  items: Array<{
    id: string;
    userEmail: string;
    userName: string;
    day: string;
    /** 本次实际发放 (含连签加成), 快照值 */
    credits: number;
    /** 当时的连续天数快照 */
    streak: number;
    createdAt: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
  summary: {
    count: number;
    /** 累计发放积分, 与 CreditLedger 对账用 */
    creditsIssued: number;
  };
}

/** GET /api/v1/admin/invites/rules */
export interface InviteRule {
  inviterCredits: number;
  inviteeCredits: number;
  triggerOn: 'first_pay' | 'register';
  valid: boolean;
  updatedAt: string | null;
  configured: boolean;
}

/**
 * GET /api/v1/admin/checkin/rules
 *
 * ⚠ 字段名以**后端实际返回**为准 (用 curl 核对过):
 *   bonusRules 而非 bonuses; enabled 而非 valid;
 *   另有 maxStreak / dailyCap / configured 三个字段我最初漏了。
 * 写前端类型时必须实测接口, 不能只看 DTO 类名推断。
 */
export interface CheckinRule {
  baseCredits: number;
  /** 连续加成项 */
  bonusRules: Array<{ day: number; bonus: number }>;
  /** 连续签到上限天数, 0 = 不限 */
  maxStreak: number;
  /** 每日签到可得积分上限, 0 = 不限 */
  dailyCap: number;
  enabled: boolean;
  updatedAt: string | null;
  /** 是否已配置过 (false 表示从未保存, 展示用代码默认值) */
  configured: boolean;
}

/* ────────────────────────────────────────────────────────────────
   营销中心 · C 端 (M11)
   ──────────────────────────────────────────────────────────────── */

/** GET /api/v1/marketing/invites */
export interface MyInvites {
  /** 本人邀请码。首次访问时惰性生成并落库 */
  inviteCode: string;
  rule: InviteRule;
  /** 规则已配置且至少有一项奖励 > 0。为 false 时页面须如实说明不发积分 */
  enabled: boolean;
  metrics: {
    totalInvited: number;
    rewardedCount: number;
    pendingCount: number;
    /** 已发放关系的累计收益。未发放的不计入 —— 展示未到账的收益属虚假宣传 */
    earnedCredits: number;
    /** 待发放关系的预估收益, 随规则变化, 展示时须标注为估算 */
    pendingCredits: number;
  };
  relations: Array<{
    id: string;
    boundAt: string;
    rewardStatus: 'pending' | 'granted' | 'rejected';
    /** 已打码的被邀请人标识 */
    inviteeName: string;
  }>;
}

/** GET /api/v1/marketing/checkin */
export interface CheckinStatus {
  rule: CheckinRule;
  /** 本地日期 YYYY-MM-DD */
  today: string;
  checkedIn: boolean;
  todayCredits: number;
  /** 当前连续签到天数 (今天没签不立即算断签) */
  streak: number;
  nextStreak: number;
  nextCredits: number;
  /** 未来 7 天逐日可得, 让用户看清连签路线 */
  forecast: Array<{ day: string; streak: number; credits: number }>;
  /** 服务端当前时间戳 —— 倒计时基准, 不得用本地时间自减 */
  serverNow: string;
}

/** POST /api/v1/marketing/quote */
export interface MarketingQuote {
  subtotalCents: number;
  discountCents: number;
  payableCents: number;
  appliedSource: 'coupon' | 'campaign' | null;
  appliedCouponCode: string | null;
  appliedCampaignId: string | null;
  /** 券与活动不叠加时的明确说明, 避免用户以为算错了 */
  notStackedNotice: string | null;
  coupons: Array<{
    id: string;
    code: string;
    name: string;
    discountCents: number;
    valueLabel: string;
    thresholdLabel: string;
  }>;
  items: Array<{
    productId: string;
    name: string;
    priceCents: number;
    credits: number;
    quantity: number;
    available: boolean;
  }>;
}

/**
 * GET /api/v1/marketing/popup (匿名可访问)
 *
 * `serverNow` 必须用于倒计时基准: 直接用本地时间倒计时在用户改系统时间、
 * 或跨时区访问时会算出错误剩余时间, 造成"活动已结束却仍显示可领"的假承诺。
 */
export interface PopupCampaign {
  id: string;
  title: string;
  body: string;
  ctaText: string;
  ctaUrl: string;
  startAt: string;
  endAt: string;
  serverNow: string;
}

/* ────────────────────────────────────────────────────────────────
   定时任务 (admin-prd.md §3.18 B-90 / M9.5)
   ──────────────────────────────────────────────────────────────── */

/** GET /api/v1/admin/scheduler/status */
export interface AdminSchedulerTask {
  /** 任务标识, 如 'order-expire' | 'credit-expire' | 'backup' */
  name: string;
  label: string;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastSuccess: boolean | null;
  lastError: string | null;
  /** 连续失败次数。> 0 即任务已停止生效 */
  consecutiveFailures: number;
  totalRuns: number;
}

export interface AdminSchedulerStatus {
  tasks: AdminSchedulerTask[];
  /** 允许手动触发的任务名。只有幂等低风险的才开放 */
  manuallyRunnable: string[];
  /** 当前有连续失败的任务名, 前端据此置顶告警 */
  failing: string[];
}
