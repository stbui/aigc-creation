import type { AdminUserMembershipFields } from './admin-users';
/**
 * 能力标识。清单以后端 capability.registry 为准 (15 项), 前端不枚举 ——
 * 保留基础联合仅用于类型提示, 运行时以 CapabilityDef.id 为准。
 */
export type KnownCapability = "main_image" | "detail_image" | "matting";
export type Capability = KnownCapability | (string & {});

/**
 * 能力模式: real=已接入真实模型通道 / planned=尚未开放。
 *
 * 2026-10-22 起没有 mock 一档 —— 本地占位实现已从后端删除, 没有真实产出路径的
 * 能力不该对用户开放。
 */
export type CapabilityMode = "real" | "planned";
export type CapabilityGroupId = "ecommerce_gen" | "ai_retouch" | "ai_video";
export type ParamType = "enum" | "number" | "text" | "boolean";

export interface ParamOption {
  value: string | number;
  label: string;
  /** 枚举项附加数据（随 /capabilities 下发）：平台主图规格等 */
  meta?: ParamOptionMeta;
}

export interface ParamOptionMeta {
  /** 平台主图推荐比例 */
  ratio?: string;
  /** 平台主图推荐画质档 */
  size?: string;
  /** 平台主图最短边要求（px） */
  minPx?: number;
  /** 一句话规格说明 */
  spec?: string;
  /** 详情长图规格（详情页专用） */
  detail?: PlatformDetailSpec;
}

export interface PlatformDetailSpec {
  /** 推荐画质档 */
  size?: string;
  /** 建议宽度（px） */
  widthPx?: number;
  /** 一句话说明 */
  spec?: string;
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
  /** 文本参数的完整格式约束（如 HEX: ^#[0-9a-fA-F]{6}$） */
  pattern?: string;
  /** 文本参数允许保留的最大长度；缺省由具体表单决定 */
  maxLength?: number;
  step?: number;
  placeholder?: string;
  help?: string;
  /** 由页面代填的技术参数（如遮罩素材 id），通用表单不渲染 */
  hidden?: boolean;
}

/**
 * 能力的**运行时真相**（2026-10-21）—— 与静态的 `mode` 正交。
 *
 * `mode` 说「代码实现到什么程度」，`runtime.effective` 说「此刻按下去会发生什么」：
 * 后台下线的能力是 `disabled`；没有可用模型通道的是 `unavailable`。
 * 界面标注一律看这里，不看 mode。
 *
 * ⚠️ 它是**事前预期**；单次生成实际走的哪条路以任务结果里的 `provider`
 * 为准。2026-10-25 起本地生成已移除，新任务只会是 gateway。
 */
export interface CapabilityRuntime {
  /** 后台管控开关（无记录 = 启用） */
  enabled: boolean;
  /** 该能力此刻是否具备可用的模型线路 */
  remoteAvailable: boolean;
  /** 一句话结论 */
  effective: "remote" | "disabled" | "unavailable";
  /** 给用户看的原因 */
  reason: string;
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
   * 与 mode **正交**: mode 说实现到什么程度 (real/planned),
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
  /** 运行时真相（后端未下发时前端按 mode 兜底） */
  runtime?: CapabilityRuntime;
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
  /** 来源标记（恒为 `model`：文本没有本地兜底） */
  source: string;
  /** 上游实际使用的模型键 */
  model?: string;
  /** 上游返回的原始 usage（各家字段不同，原样透出） */
  usage?: Record<string, unknown>;
}

/** POST /api/v1/mobile-upload/sessions —— 电脑端创建会话 */
export interface MobileUploadSessionCreated {
  sessionId: string;
  /** 手机端上传令牌 —— 需随二维码一起给到手机端 */
  token: string;
  /** 过期时间戳 (毫秒) */
  expiresAt: number;
  status: "waiting" | "received" | "expired";
}

/** 手机上传接收到的单张素材 */
export interface MobileUploadAsset {
  id: string;
  /** 素材的干净地址 —— 由后端给出 (前端不能从 assetId 推出存储 key) */
  url: string;
  /** 带签名的可显示地址; 未开启 ASSET_SIGNING_SECRET 时为 null */
  signedUrl?: string | null;
  /** 手机端原始文件名 */
  filename: string;
}

/** GET /api/v1/mobile-upload/sessions/:id —— 电脑端轮询 */
export interface MobileUploadSessionStatus {
  sessionId: string;
  status: "waiting" | "received" | "expired";
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

/**
 * 任务状态。
 *
 * `queued` 排队中（还没被 worker 领取）/ `running` 执行中 / `succeeded` 成功 /
 * `failed` 失败 / `cancelled` 后台终止。旧版 `pending` 已废止，存量数据在改造
 * 时统一改写为 `queued`。
 */
export type TaskStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
  /** 可选手机号。填了必须同时给 smsCode（后端强制校验归属） */
  phone?: string;
  /** 短信验证码，由 POST /auth/sms/send (purpose=verify) 下发 */
  smsCode?: string;
  /** 同意的用户协议版本号（GET /legal/user-agreement 的 version），用于同意留痕 */
  consentVersion?: string;
}

/** 短信验证码用途：login 登录 / verify 注册时验证号码归属 */
export type SmsPurpose = "login" | "verify";

export interface SmsLoginRequest {
  phone: string;
  code: string;
}

export interface UserProfile {
  id: string;
  email: string;
  /** 手机号（未绑定为 null） */
  phone?: string | null;
  name?: string;
  /** 后台角色: 'user' | 'admin' | 'operator' | 'finance'。前端据此决定是否请求后台身份 */
  role?: string;
}

export interface AuthResponse {
  accessToken: string;
  user?: UserProfile;
}

/** 扫码登录（B8）。票据明文只出现在建码响应里，由前端渲染成二维码 */
export interface QrCreateResult {
  ticket: string;
  expiresAt: string;
  ttlSeconds: number;
  pollIntervalMs: number;
}

export type QrSessionStatus =
  "pending" | "scanned" | "confirmed" | "consumed" | "expired" | "cancelled";

/**
 * 轮询/扫码/确认的统一回执。
 *
 * `accessToken` 只在**兑换成功的那一次**轮询里出现 —— 票据随即转 consumed，
 * 之后同票据再查只会拿到 status=consumed。
 */
export interface QrStatusResult {
  status: QrSessionStatus;
  expiresAt: string;
  scannedAt?: string | null;
  accessToken?: string;
  user?: UserProfile;
  /** 发起端信息：手机端确认前必须展示，让人认出是不是自己的设备 */
  desktop?: { ip: string | null; ua: string | null; createdAt: string | null };
}

export interface Project {
  id: string;
  name: string;
  createdAt?: string;
}

// 与后端 Prisma Asset 模型对齐 (backend/prisma/schema.prisma)
// 后端 src/assets/assets.service.ts createOriginal 返回完整 Asset 记录,
// 注意字段是 sourceUrl 而非 url。
/**
 * AIGC 标识结果 (B5)。后端 `common/aigc-label.ts` 产出, 落在
 * `Asset.aigcMeta` / `GenerationTask.aigcMeta`。
 *
 * · `visible`  —— 图上是否已合成「AI 生成」角标
 * · `metadata` —— 文件内是否写了 XMP / DigitalSourceType
 * · `method: 'api-only'` 是视频: 没有 ffmpeg 无法写容器元数据,
 *   合规靠接口字段 + 播放器角标, 前端必须据此自己画角标。
 */
export interface AigcMeta {
  labeled: boolean;
  metadata: boolean;
  visible: boolean;
  method:
    "png-text+xmp" | "jpeg-xmp" | "visible-only" | "unsupported" | "api-only";
  warning?: string;
}

export interface Asset {
  id: string;
  projectId: string;
  ownerId: string;
  kind: "original" | "generated" | string;
  capability?: Capability | null;
  /**
   * 干净地址 (不带签名)。**服务端内部用途 + 未开启签名时的兜底**。
   * 渲染 `<img>` 请用 `assetSrc()`, 它会优先取 `signedUrl`。
   */
  sourceUrl: string;
  /** 开启 ASSET_SIGNING_SECRET 后有值; 未开启为 null */
  signedUrl?: string | null;
  /** AIGC 标识结果 (生成图才有) */
  aigc?: AigcMeta | null;
  /** 原始 JSON 串, 一般不用; 调试/后台展示时可读 */
  aigcMeta?: string;
  width?: number | null;
  height?: number | null;
  format: string;
  sizeBytes: number;
  /** 写入时的存储后端: 'local' | 'oss' | 'minio' (决定能否走本地缩略图管线) */
  storageBackend?: string | null;
  createdAt: string;
  /**
   * 来源元数据: 只有浏览器扩展「图片采集」上传的 original 素材才有值。
   * 仅作展示与溯源, 服务端不据此鉴权或抓取。
   */
  sourceSite?: string | null;
  sourceTitle?: string | null;
  sourcePageUrl?: string | null;
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
  /**
   * 前台模型 id（`LogicalModel.id`）。
   *
   * 必填：渠道、协议、价格一律由服务端按所选模型解析，前端只表达「用哪个模型」。
   */
  logicalModelId: string;
  inputAssetIds: string[];
  params: Record<string, unknown>;
  /** 客户端请求幂等键；网络超时重试时复用同一值。 */
  idempotencyKey?: string;
}

export interface GenerateResponse {
  taskId: string;
  id?: string;
  status?: TaskStatus;
  /** 本次合计消耗（多图产出按张计费，已是 N 张之和） */
  creditCost?: number;
  idempotentHit?: boolean;
  /** 多图产出的批次 id（一次生成拆成 N 个任务时才有） */
  batchId?: string;
  /** 本批次产出张数；单图能力缺省 */
  batchSize?: number;
}

// 后端 getTask 与 listTasks 都返回 outputAsset（后者用于历史缩略图/复用）。
// 错误码字段是 errorCode 而非 error。
export interface Task {
  id: string;
  projectId: string;
  capability: Capability;
  status: TaskStatus;
  inputAssetIds?: string[];
  /**
   * 输入素材（原图）的完整信息。详情图结果行要按批次展示「原图 + 商品名称」，
   * 只给 id 的话前端还得为每行再查一次素材。
   */
  inputAssets?: TaskOutputAsset[];
  /**
   * 同一次生成的父任务 id。一次生成按模块拆成 N 个任务时，第 2..N 张挂在
   * 首张之下（每张各有一条账单），前端按 params.batchId 聚合成一行。
   */
  parentTaskId?: string | null;
  params?: Record<string, unknown>;
  provider?: string | null;
  errorCode?: string | null;
  /**
   * 建任务时选定的前台模型 id（`LogicalModel.id`）。
   * 作品页「重新生成」沿用它，保证重试落在与原任务相同的模型上；
   * 改造前的存量任务为 null。
   */
  logicalModelId?: string | null;
  /** 本次实际扣掉的积分快照。改价不影响已创建的任务 */
  creditCost?: number;
  /** 该能力的产出模态（后端按能力下发），轮询上限据此区分图像/视频 */
  modality?: Modality;
  createdAt?: string;
  updatedAt?: string;
  outputAsset?: TaskOutputAsset | null;
  /**
   * 同一任务的完整产出列表。多图融合一次可产出 1-4 张真实变体；
   * 首项与 outputAsset 相同。旧后端/旧任务缺省时按 [outputAsset] 处理。
   */
  outputAssets?: TaskOutputAsset[];
}

export interface TaskOutputAsset extends Pick<
  Asset,
  | "id"
  | "sourceUrl"
  | "signedUrl"
  | "aigc"
  | "capability"
  | "width"
  | "height"
  | "format"
> {
  /**
   * 产出模态 (2026-10-20 视频通道落地) —— 前端据此选 `<img>` 还是 `<video>`。
   *
   * 后端按**产出的 mime** 推导, 而非查能力注册表: 产出形态是文件的真实
   * 形态, 不该由「当初打算产出什么」决定。
   */
  modality?: Modality;
  /** 视频时长 (毫秒); 仅视频产出有值 */
  durationMs?: number | null;
}

export type TaskListResult = Task[];

/** GET /tasks/page?limit=&offset=&capability= */
export interface TaskPageResult {
  items: Task[];
  total: number;
  limit: number;
  offset: number;
}

/* ────────────────────────────────────────────────────────────────
   后台管理端类型 (docs/admin-prd.md §3功能需求)
   端点均在 /api/v1/admin/* 下, 由 AdminGuard + PermissionGuard 双重校验。
   ──────────────────────────────────────────────────────────────── */

/** 后台角色。'user' 是 C 端用户, 无任何后台权限 */
export type AdminRole = "admin" | "operator" | "finance";

/** 账号状态 */
export type UserStatus = "active" | "disabled" | "deleted";

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

/** GET /api/v1/admin/alerts — 顶栏告警中心 */
export type AdminAlertSeverity = "critical" | "warning" | "info";

export interface AdminAlertItem {
  key: string;
  severity: AdminAlertSeverity;
  category: "ticket" | "task" | "finance" | "backup" | "invoice";
  title: string;
  detail: string;
  count: number | null;
  link: string;
}

export interface AdminAlertsResult {
  generatedAt: string;
  total: number;
  items: AdminAlertItem[];
}

/** GET /api/v1/admin/overview — 平台概览 */
export interface AdminOverview {
  /** 数据生成时间（后端 30 秒缓存） */
  generatedAt: string;
  cacheTtlSeconds: number;
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
    queued: number;
    /** 百分比, 无已完成任务时为 null (不是 0 —— 0 表示"全部失败") */
    successRate: number | null;
    assets: number;
    originals: number;
    generated: number;
  };
  /** 按日聚合并补齐无数据日, 天数与 days 一致 */
  trend: Array<{
    date: string;
    total: number;
    succeeded: number;
    failed: number;
  }>;
  /** 窗口口径（与 trend 同源），回答「最近表现」而不是累计数字 */
  window: {
    tasks: number;
    succeeded: number;
    failed: number;
    /** 窗口内成功率, 无已完成任务时为 null */
    successRate: number | null;
    /** 失败原因 Top 6, errorCode 由前端翻译 */
    failureReasons: Array<{ errorCode: string; count: number }>;
    revenue: {
      gmvCents: number;
      paidOrders: number;
      refundedCents: number;
      usersNew: number;
    };
  };
  /** 上一窗口的同口径数字，用于环比 */
  comparison: {
    tasks: number;
    succeeded: number;
    failed: number;
    successRate: number | null;
    usersNew: number;
    gmvCents: number;
    paidOrders: number;
    refundedCents: number;
  };
  /**
   * 交易侧概览 (2026-10-21 补)。
   *
   * 金额一律**整数分**, 前端负责除以 100 展示 —— 后端不做展示层格式化。
   */
  commerce: {
    orders: {
      total: number;
      pending: number;
      paid: number;
      cancelled: number;
      refunded: number;
      partialRefunded: number;
    };
    /** 累计 GMV = 实付之和 (不含未支付订单) */
    gmvCents: number;
    /** 窗口内 GMV */
    gmvWindowCents: number;
    /** 待付订单金额 */
    pendingCents: number;
    refundedCents: number;
    refundedWindowCents: number;
    /** 支付成功率 (%), 无支付流水时为 null */
    paymentSuccessRate: number | null;
    members: { active: number; newInWindow: number };
    credits: { grantedInWindow: number; consumedInWindow: number };
    /** 窗口内收入按支付渠道拆分 */
    channelMix: Array<{ channel: string; gmvCents: number; orders: number }>;
    /** 按支付时间聚合的收入趋势 */
    revenueTrend: Array<{ date: string; gmvCents: number; orders: number }>;
  };
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
    role: AdminRole | "user";
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
/** 后台用户详情的最近登录记录 (B2) */
export interface AdminLoginLogItem {
  id: string;
  ip: string | null;
  ua: string | null;
  success: boolean;
  /** 'password' | 'sms' 为成功渠道; 'bad_credentials' | 'disabled' | 'deleted' | 'sms_code' 为失败原因 */
  reason: string;
  createdAt: string;
}

export interface AdminLoginLogResult {
  items: AdminLoginLogItem[];
  total: number;
  failedLast30Days: number;
}
export interface AdminUserDetail extends AdminUserMembershipFields {
  /** 绑定的手机号（未绑定为 null） */
  phone?: string | null;
  phoneVerifiedAt?: string | null;
  id: string;
  email: string;
  name: string;
  role: AdminRole | "user";
  roleLabel: string;
  status: UserStatus;
  statusLabel: string;
  createdAt: string;
  lastLoginAt: string | null;
  stats: {
    projects: number;
    tasks: number;
    assets: number;
    taskStatus: {
      succeeded: number;
      failed: number;
      running: number;
      queued: number;
    };
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

/** 系统设置值。写入按 SETTING_DEFS 的 key 提交，后端负责类型与范围校验 */
export type AdminSettingValue = string | number | boolean;

/** 系统设置写入载荷。`clears` 表示删除运行时覆盖、回落代码默认值 */
export interface AdminSettingsUpdatePayload {
  settings: Record<string, AdminSettingValue>;
  clears?: string[];
}

/** 系统设置写入结果（含逐项 before/after，供审计与页面提示） */
export interface AdminSettingsUpdateResult {
  updated: string[];
  cleared: string[];
  changes: Array<{
    key: string;
    label: string;
    before: AdminSettingValue;
    after: AdminSettingValue;
    action: "update" | "clear";
  }>;
}

/** GET /api/v1/admin/settings */
export interface AdminSettings {
  groups: Array<{
    key: string;
    label: string;
    items: Array<{
      /** SETTING_DEFS 键, 带点号 (site.name)。写入与恢复默认都用它 */
      key: string;
      label: string;
      description: string;
      type: "string" | "number" | "boolean";
      value: AdminSettingValue;
      default: AdminSettingValue;
      min?: number;
      max?: number;
      maxLength?: number;
      /** 允许取值的枚举；存在时渲染下拉而不是自由输入 */
      enum?: number[];
      /** 只读项：真实旋钮在别处，页面只展示当前值并给出跳转 */
      readOnly?: boolean;
      /** 只读项的跳转目标（后台路由） */
      linkTo?: string;
      overridden: boolean;
      group: string;
      updatedBy: string | null;
      updatedAt: string | null;
    }>;
  }>;
}

// ── AIGC 可见角标样式 (2026-10-21) ─────────────────────────────────

export type AigcLabelPosition =
  "bottom-right" | "bottom-left" | "top-right" | "top-left";

/**
 * 角标样式。渲染字段（文案/字体/配色）由浏览器画进位图，
 * 几何字段（位置/比例/边距/透明度）在服务端合成时实时生效。
 */
export interface AigcLabelSpec {
  /** 是否在产出图上显示可见角标（关闭后仍写隐式标识） */
  enabled: boolean;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  letterSpacing: number;
  textColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  radius: number;
  paddingX: number;
  /** 空串 = 不画圆点 */
  dotColor: string;
  position: AigcLabelPosition;
  scalePercent: number;
  minWidthPx: number;
  maxWidthPx: number;
  marginPercent: number;
  opacity: number;
}

/** GET /api/v1/admin/aigc-label */
export interface AdminAigcLabel {
  spec: AigcLabelSpec;
  defaults: AigcLabelSpec;
  badge: {
    source: "default" | "custom";
    width: number;
    height: number;
    /** 位图是否按旧样式渲染（true 时提示重新保存） */
    stale: boolean;
    pngBase64: string | null;
    updatedBy: string | null;
    updatedAt: string | null;
  };
}

/** GET /api/v1/aigc-label（公开）—— 视频播放器角标用 */
export interface PublicAigcLabel {
  enabled: boolean;
  text: string;
  textColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  radius: number;
  dotColor: string;
  position: AigcLabelPosition;
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

/**
 * 模态 —— 2026-10-20 起配置与路由的一等维度。
 *
 * 厂商与模态是多对多 (优云智算有图无文, DeepSeek 有文无图),
 * 故任何按厂商推断模态的写法都是错的, 必须显式声明。
 */
export type Modality = "text" | "image" | "video";

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
export type OrderStatus =
  "pending" | "paid" | "cancelled" | "refunded" | "partial_refunded";

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

/** GET /orders?limit=&offset= */
export interface OrderListResult {
  items: Order[];
  total: number;
  limit: number;
  offset: number;
  statusCounts: Partial<Record<OrderStatus, number>>;
}

export interface Order {
  id: string;
  orderNo: string;
  status: OrderStatus;
  /** 商品原价小计（会员订阅单为套餐原价） */
  itemsSubtotalCents?: number;
  totalCents: number;
  /** 会员加油包折扣（非会员为 0） */
  memberDiscountCents?: number;
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
  /** 会员订阅单的套餐信息。非会员单为 null */
  membershipPlanId?: string | null;
  membershipPlanCode?: string | null;
  membershipPlanName?: string | null;
  /** 会员权益已发放的时刻 (null = 已支付但尚未激活) */
  membershipAppliedAt?: string | null;
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
  status: "active" | "expired" | "exhausted";
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

/** GET /credits/ledger?limit=&offset=&type=&direction=income|expense */
export interface CreditLedgerPage {
  items: CreditLedgerEntry[];
  total: number;
  limit: number;
  offset: number;
}

/** 能力消耗价一行 (后台改价用) */
export interface AdminCreditPrice {
  capabilityId: string;
  capabilityName: string;
  /** 运行时生效价 */
  cost: number;
  /**
   * setting = 后台覆盖中; registry = 用代码默认值;
   * campaign = 被进行中的限时免费活动覆盖（此时 cost 恒为 0，改价不生效）
   */
  source: "setting" | "registry" | "campaign";
  overridden: boolean;
  /** 代码默认值, 供「回落」时对照 */
  registryDefault: number;
  /** 是否被进行中的限时免费活动覆盖 */
  freeCampaign: boolean;
}

/** 后台「能力管控」列表行（GET /admin/capabilities） */
export interface AdminCapabilityControl {
  capabilityId: string;
  name: string;
  group: string;
  modality: "image" | "text" | "video";
  mode: CapabilityMode;
  /** 后台开关（无记录 = true） */
  enabled: boolean;
  reason: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  runtime: CapabilityRuntime;
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
  perks: MembershipPlan["perks"];
  expiresAt: string | null;
  monthlyCredits: number;
  /** 已取消自动续费，但当前已付周期仍有效 */
  cancelAtPeriodEnd: boolean;
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
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  /** 实际通道: gateway=真实模型 / local=停用前的历史本地产出 / pending=改造前的历史初始值 */
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
  queued: number;
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
  status: AdminTask["status"];
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
  timeline: Array<{
    key: string;
    label: string;
    at: string | null;
    done: boolean;
  }>;
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
  trigger: "manual" | "scheduled";
  status: "pending" | "succeeded" | "failed";
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

/** GET /api/v1/admin/retention/logs */
export interface AdminCleanupLog {
  id: string;
  target: string;
  deletedCount: number;
  retentionDays: number;
  trigger: "manual" | "scheduled";
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
export type StorageBackendId = "local" | "oss" | "minio";

/** 素材上架状态。hidden = 已下架, 用户端不可见但记录与文件保留 */
export type AssetStatus = "visible" | "hidden";

/** GET /api/v1/admin/assets */
export interface AdminAssetListResult {
  items: Array<{
    id: string;
    kind: "original" | "generated";
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
export type CouponType = "full_cut" | "discount" | "fixed";
/** 券适用范围: all 全站 | product 指定商品 | new_user 仅新用户首单 */
export type CouponScope = "all" | "product" | "new_user";
export type CouponStatus = "on" | "off";
export type CampaignType = "limited_price" | "limited_free" | "popup";
export type CampaignStatus = "draft" | "active" | "ended" | "off";

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
  effective: "on" | "off" | "expired" | "not_started" | "sold_out";
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
  effective: "draft" | "live" | "scheduled" | "ended" | "off";
  audience: { onlyNewUsers?: boolean };
  createdAt: string;
  updatedAt: string;
}

export interface UpsertCampaignPayload {
  name: string;
  type: CampaignType;
  payload?: AdminCampaign["payload"];
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
    rewardStatus: "pending" | "granted" | "rejected";
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
  triggerOn: "first_pay" | "register";
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
    rewardStatus: "pending" | "granted" | "rejected";
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
  /** 会员加油包折扣（非会员为 0），与券/活动优惠分开展示 */
  memberDiscountCents: number;
  /** 券 / 限时活动优惠（不含会员折扣） */
  discountCents: number;
  payableCents: number;
  appliedSource: "coupon" | "campaign" | null;
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

/**
 * 进行中的限时活动（`GET /marketing/campaigns`）。
 *
 * 只含真正影响价格的两种：限时价（带目标商品与生效活动价）与限时免费
 * （带免费覆盖的能力）。商品下架、活动价不低于原价的活动后端已过滤掉，
 * 前端拿到即可直接展示，不再二次判断 —— 判定口径只有后端一份。
 */
export interface PromoCampaign {
  id: string;
  name: string;
  type: "limited_price" | "limited_free";
  startAt: string;
  endAt: string;
  /** 限时价活动的目标商品 */
  product?: { id: string; sku: string; name: string; priceCents: number };
  /** 实际生效的活动价（分），限时价活动才有 */
  priceCents?: number;
  /** 限时免费覆盖的能力 id */
  capabilityIds?: string[];
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

/* ────────────────────────────────────────────────────────────────
   交易后台: 商品 / 订单 / 支付流水 / 积分账本 / 保留期清理 (B1)
   ──────────────────────────────────────────────────────────────── */

/** 商品。金额一律整数分; sku 创建后不可改 */
export interface AdminProduct {
  id: string;
  sku: string;
  name: string;
  description: string;
  type: string;
  priceCents: number;
  originalPriceCents: number | null;
  credits: number;
  creditsValidDays: number;
  grantType: "immediate" | "manual";
  status: "active" | "offline";
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductPayload {
  sku: string;
  name: string;
  description?: string;
  priceCents: number;
  originalPriceCents?: number;
  credits: number;
  creditsValidDays?: number;
  grantType?: "immediate" | "manual";
  status?: "active" | "offline";
  sortOrder?: number;
}

/**
 * sku 不可改: 历史订单与外部对账都靠它认商品。
 *
 * `originalPriceCents` 允许显式传 null —— 那是「清空划线价」, 与「不改」
 * (不传该字段) 是两件事, 用 undefined 表达不了后者之外的语义。
 */
export type UpdateProductPayload = Partial<
  Omit<CreateProductPayload, "sku" | "originalPriceCents">
> & {
  originalPriceCents?: number | null;
};

/** 会员权益。与后端 MembershipService.Perks 同构 */
export interface AdminMembershipPerks {
  fastChannel: boolean;
  /** 同时进行中任务上限。0 = 不限 */
  maxConcurrent: number;
  /** 加油包折扣万分比。9500 = 95 折，10000 = 无折扣 */
  addonDiscountBps: number;
}

/** GET /api/v1/admin/membership-plans */
export interface AdminMembershipPlan {
  id: string;
  code: string;
  name: string;
  description: string;
  priceCents: number;
  durationDays: number;
  monthlyCredits: number;
  perks: AdminMembershipPerks;
  /** 权益文案由后端生成 */
  perkLabels: string[];
  status: "active" | "offline";
  sortOrder: number;
  memberCount: number;
  orderCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminMembershipPlanList {
  items: AdminMembershipPlan[];
}

export interface AdminMembershipPlanPayload {
  name: string;
  description?: string;
  priceCents: number;
  durationDays: number;
  monthlyCredits: number;
  perks: AdminMembershipPerks;
  sortOrder?: number;
}

export interface CreateAdminMembershipPlanPayload extends AdminMembershipPlanPayload {
  code: string;
  status?: "active" | "offline";
}

export type AdminOrderStatus =
  "pending" | "paid" | "cancelled" | "refunded" | "partial_refunded";

/** GET /api/v1/admin/orders 的一行 */
export interface AdminOrderRow {
  id: string;
  orderNo: string;
  userId: string;
  userEmail: string;
  status: AdminOrderStatus;
  channel: string | null;
  totalCents: number;
  discountCents: number;
  paidCents: number;
  refundedCents: number;
  grantedCredits: number;
  itemCount: number;
  paymentCount: number;
  membershipPlanCode: string | null;
  membershipPlanName: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface AdminOrderListResult {
  items: AdminOrderRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminOrderPayment {
  id: string;
  channel: string;
  payTransactionId: string;
  amountCents: number;
  status: string;
  message: string | null;
  sandboxScenario: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface AdminOrderRefund {
  id: string;
  amountCents: number; creditsReclaimed: number; creditsUnreclaimable: number; providerRefundId: string | null;
  reason: string;
  status: string; detail: string;
  operatorId: string | null;
  createdAt: string;
}

/** GET /api/v1/admin/orders/:id —— 明细 / 支付 / 退款 / 券与套餐一次取全 */
export interface AdminOrderDetail {
  id: string;
  orderNo: string;
  userId: string;
  status: AdminOrderStatus;
  channel: string | null;
  totalCents: number;
  discountCents: number;
  paidCents: number;
  refundedCents: number;
  grantedCredits: number;
  couponSnapshot: string | null;
  membershipPlanId: string | null;
  membershipAppliedAt: string | null;
  paidAt: string | null;
  /** 超时关闭时刻。库中必填, 不会为 null */
  expiresAt: string;
  createdAt: string;
  user: { id: string; email: string; name: string; role: string };
  items: Array<{
    id: string;
    productId: string;
    skuSnapshot: string;
    nameSnapshot: string;
    priceCentsSnapshot: number;
    creditsSnapshot: number;
    validDaysSnapshot: number;
    quantity: number;
  }>;
  payments: AdminOrderPayment[];
  refunds: AdminOrderRefund[];
  coupon: { code: string; name: string } | null;
  campaign: { id: string; name: string; type: string } | null;
  membershipPlan: {
    id: string;
    code: string;
    name: string;
    durationDays: number;
    monthlyCredits: number;
  } | null;
}

/** GET /api/v1/admin/credits —— 用户余额总览 */
export interface AdminCreditRow {
  userId: string;
  email: string;
  name: string;
  balance: number;
  expiringSoon: number;
  totalEarned: number;
  totalConsumed: number;
  activeLots: number;
  nearestExpiry: string | null;
}

export interface AdminCreditListResult {
  items: AdminCreditRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** 后台看到的批次是原始行 (含已过期与已用完), 不做状态归并 */
export interface AdminCreditLotRow {
  id: string;
  source: string;
  orderId: string | null;
  totalCredits: number;
  remainingCredits: number;
  expireAt: string | null;
  createdAt: string;
}

export interface AdminCreditLedgerRow {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  lotId: string | null;
  orderId: string | null;
  taskId: string | null;
  reason: string | null;
  operatorId: string | null;
  createdAt: string;
}

/** POST /api/v1/admin/credits/batch-adjust —— 逐条独立执行 */
export interface AdminBatchAdjustResult {
  total: number;
  succeeded: number;
  failed: number;
  /** 命中幂等键的行数（重试时会 > 0，说明这次没重复发放） */
  idempotentHits: number;
  results: Array<{
    userId: string;
    success: boolean;
    balance?: number;
    message?: string;
    idempotentHit?: boolean;
  }>;
}

/** GET /api/v1/admin/retention/targets */
export interface AdminRetentionTarget {
  table: string;
  label: string;
  note: string;
  retentionDays: number;
  total: number;
  /** 按当前保留天数会被删除的条数 (仅预估) */
  expiring: number;
  cutoff: string;
  oldestAt: string | null;
}

// ══════════════════════════════════════════════════════════════════════
// 支付通道 / 发票 / 对账 (B3)
// ══════════════════════════════════════════════════════════════════════

/**
 * 发起支付的结果 (`POST /payments/:orderId/intent`)。
 *
 * `mode` 决定前端怎么拉起支付:
 *   redirect → 跳 `payUrl` 到渠道收银台 (支付宝)
 *   qrcode   → 用 `codeUrl` 渲染二维码 (微信 Native)
 *   sandbox  → 走站内沙箱模拟 (`POST /orders/:id/pay`)
 *   free     → 0 元订单已由后端直接入账，前端只需展示结果
 */
/** GET /payments/providers 的可用支付渠道 */
export interface PaymentProviderInfo {
  id: string;
  name: string;
  icon: string | null;
  /** redirect=跳转收银台 / qrcode=扫码 / sandbox=站内模拟 */
  checkoutMode: "redirect" | "qrcode" | "sandbox";
  supportedCurrencies: string[];
  sandbox: boolean;
}

export interface PaymentIntent {
  orderId: string;
  orderNo: string;
  amountCents: number;
  currency: string;
  /** 实际固定下来的渠道配置；0 元单为 free */
  providerId:
    | "sandbox"
    | "alipay"
    | "wechat"
    | "paypal"
    | "stripe"
    | "epay"
    | "zpay"
    | "free";
  configId: string | null;
  configVersion: number | null;
  mode: "redirect" | "qrcode" | "sandbox" | "free";
  payUrl?: string;
  codeUrl?: string;
  checkoutValue: string | null;
  expiresAt: string;
  hint?: string | null;
  /** 沙箱通道: 界面必须显式标注「不产生真实扣款」 */
  sandbox: boolean;
}

/** 支付状态轮询 (`GET /payments/:orderId/status` / `POST /payments/:orderId/query`) */
export interface PaymentStatusResult {
  orderId: string;
  orderNo: string;
  status: OrderStatus;
  displayStatus: string;
  amountCents: number;
  currency: string;
  providerId: string;
  checkoutMode: string | null;
  checkoutValue: string | null;
  expiresAt: string;
  providerPaidAt: string | null;
  creditedAt: string | null;
  closedAt: string | null;
  lastError: string | null;
  payments: Array<{
    id: string;
    status: string;
    providerId: string;
    providerRef: string | null;
    providerTradeNo: string | null;
    amountCents: number;
    createdAt: string;
  }>;
}

/** 'pending' 待开具 | 'issued' 已开具 | 'rejected' 已驳回 | 'red_flushed' 已冲红 */
export type InvoiceStatus = "pending" | "issued" | "rejected" | "red_flushed";

/** 发票 (C 端) */
export interface Invoice {
  id: string;
  invoiceNo: string;
  orderId: string;
  orderNo: string | null;
  amountCents: number;
  kind: "personal" | "company";
  title: string;
  taxNo: string | null;
  email: string | null;
  content: string;
  status: InvoiceStatus;
  rejectReason: string | null;
  issuedAt: string | null; redFlushedAt: string | null; redFlushedBy: string | null; redFlushReason: string | null;
  createdAt: string;
  /** 已开具时才有: 可打印 HTML 的地址 */
  fileUrl: string | null;
  hasStoredFile: boolean;
}

export interface CreateInvoicePayload {
  orderId: string;
  kind: "personal" | "company";
  title: string;
  taxNo?: string;
  email?: string;
  content?: string;
}

/** 后台发票行 (附带申请人信息) */
export interface AdminInvoice extends Invoice {
  userEmail: string | null;
  userName: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 账户自助 / 法务 / 站内消息 (B4)
// ─────────────────────────────────────────────────────────────────────────────

export type LegalSlug =
  "user-agreement" | "privacy-policy" | "minors-policy" | "account-rules";
export type LegalStatus = "draft" | "published" | "archived";

/** 公开接口：某文档的最新已发布版本 */
export interface LegalDoc {
  slug: string;
  version: string;
  title: string;
  content: string;
  publishedAt: string;
}

/** 公开接口：三类文档的版本概览 */
export interface LegalIndexItem {
  slug: string;
  label: string;
  /** 从未发布过时为 null（前端走内置兜底文本） */
  version: string | null;
  title: string;
  publishedAt: string | null;
}

/** 后台：某文档的全部版本（含草稿与历史） */
export interface AdminLegalDoc {
  id: string;
  slug: string;
  version: string;
  title: string;
  content: string;
  status: LegalStatus;
  publishedAt: string | null;
  publishedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 我的账号 */
export interface MyProfile {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  phoneVerifiedAt: string | null;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  counts: { projects: number; tasks: number; assets: number; orders: number };
  unread: number;
}

/** 注销影响面预览 */
export interface DeletionPreview {
  email: string | null;
  name: string | null;
  createdAt: string | null;
  projects: number;
  tasks: number;
  assets: number;
  /** 订单会保留（法定留存），注销不删除 */
  orders: number;
  notifications: number;
}

/** 站内消息 */
export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  items: NotificationItem[];
  unread: number;
}

/** 后台消息模板 */
export interface MessageTemplateItem {
  id: string;
  code: string;
  channel: "inapp" | "email" | "sms";
  subject: string | null;
  body: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * 邮件 / 短信通道的生效实现。
 *
 * `delivers: false` = 当前落到 console 通道（正文只写 logs/outbox，不会真的发出去）。
 * `configured: false` = 填了真实 provider 但凭据不全，已告警并回落 console。
 */
export interface DeliveryChannelStatus {
  provider: string;
  delivers: boolean;
  configured: boolean;
  /** 邮件：发件地址；短信：签名 */
  from?: string;
  sign?: string;
}

export interface DeliveryChannelStatusMap {
  email: DeliveryChannelStatus;
  sms: DeliveryChannelStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// 工单 / 全局搜索 / 批量操作 (B7)
// ─────────────────────────────────────────────────────────────────────────────

export type TicketType =
  "bug" | "complaint" | "consultation" | "invoice" | "other";
export type TicketStatus = "open" | "processing" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high";

export interface TicketReplyItem {
  id: string;
  ticketId: string;
  /** `user` 用户 / `admin` 客服 */
  authorType: "user" | "admin";
  authorId: string;
  /** 回复当时的展示名（快照，用户改名后历史回复不变） */
  authorName: string;
  content: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  ticketNo: string;
  type: TicketType;
  typeLabel: string;
  subject: string;
  content: string;
  status: TicketStatus;
  statusLabel: string;
  priority: TicketPriority;
  orderId: string | null;
  assetId: string | null;
  assigneeId: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  replies?: TicketReplyItem[];
  replyCount?: number;
}

export interface TicketListResult {
  items: Ticket[];
  total: number;
  /** 当前用户全量工单按状态计数（不受分页影响） */
  statusCounts?: Partial<Record<TicketStatus, number>>;
}

export interface CreateTicketPayload {
  type: TicketType;
  subject: string;
  content: string;
  priority?: TicketPriority;
  orderId?: string;
  assetId?: string;
}

/** 后台工单行（附带提交人信息） */
export interface AdminTicketRow extends Ticket {
  userId: string;
  userEmail: string;
  userName: string;
  replyCount: number;
}

export interface AdminTicketListResult {
  items: AdminTicketRow[];
  total: number;
  /** 各状态分组计数（不受当前筛选影响之外的口径：与后端 groupBy 同源） */
  counts: Record<string, number>;
}

/** 后台工单详情：关联订单/素材只读摘要，财务动作回订单模块 */
export interface AdminTicketDetail extends Ticket {
  replies: TicketReplyItem[];
  user: { id: string; email: string; name: string; status: string };
  related: {
    order: {
      id: string;
      orderNo: string;
      status: string;
      totalCents: number;
      paidCents: number;
      refundedCents: number;
      createdAt: string;
    } | null;
    asset: {
      id: string;
      sourceUrl: string;
      width: number;
      height: number;
      createdAt: string;
    } | null;
  };
}

export interface TicketStats {
  open: number;
  processing: number;
  resolved: number;
  closed: number;
  /** open + processing：真正"还没解决"的量 */
  pending: number;
}

/** `GET /admin/search?q=` 的单条结果 */
export interface AdminSearchHit {
  id: string;
  title: string;
  subtitle: string;
  /** 后台站内路径，点击直接跳转 */
  link: string;
}

export interface AdminSearchGroup {
  key: "users" | "orders" | "tickets" | "tasks" | "assets";
  label: string;
  total: number;
  items: AdminSearchHit[];
}

export interface AdminSearchResult {
  query: string;
  groups: AdminSearchGroup[];
  total: number;
}

/** 批量操作逐条结果（后端 common/batch.ts） */
export interface BatchItemResult<T = unknown> {
  id: string;
  ok: boolean;
  message?: string;
  data?: T;
}

export interface BatchSummary<T = unknown> {
  total: number;
  succeeded: number;
  failed: number;
  results: BatchItemResult<T>[];
}

/** 积分 CSV 导入的逐行结果 */
export interface CreditImportResult {
  total: number;
  succeeded: number;
  failed: number;
  /** 命中幂等键的行数（同文件重试时 > 0，说明这次没重复发放） */
  idempotentHits: number;
  results: Array<{
    row: number;
    email: string;
    delta: number;
    success: boolean;
    balance?: number;
    message?: string;
    idempotentHit?: boolean;
  }>;
}

/* ------------------------------------------------------------------------- */
/* AI 带货图文（shoppable-carousel）                                            */
/* ------------------------------------------------------------------------- */

/**
 * 模板分类（参考站实拍 10 项 + 页面级「全部模板」）。
 *
 * 分类 id 是稳定英文键；「全部模板」是纯前端筛选态，不来自后端。
 */
export interface ShoppableCarouselCategory {
  id: string;
  label: string;
}

/**
 * 一个带货图文模板。
 *
 * 模板是能力定义的一部分（决定提示词的三拍结构），事实源在后端
 * `capabilities/definitions/shoppable-carousel.templates.ts`，
 * 由 `GET /shoppable-carousel/templates` 整体下发 —— 前端不另存一份清单。
 */
export interface ShoppableCarouselTemplate {
  id: string;
  name: string;
  /** 所属分类（可跨分类，一个模板可同时属于多个） */
  categoryIds: string[];
  /** 三拍叙事结构，如 ['开箱静物', '多场景上身', '细节收尾'] */
  beats: string[];
  /** 可执行的结构化提示词片段（由公开标题与三拍文案合成） */
  promptFragment: string;
  /** 卡片首图（本站静态资源相对路径） */
  thumbFile: string;
  /** 模板卡里的三张连续预览图，顺序与 beats 一致 */
  thumbFiles: string[];
}

/** GET /api/v1/shoppable-carousel/templates */
export interface ShoppableCarouselTemplatesResult {
  /** 来源页面（仅追溯用，运行时不会请求它） */
  sourceUrl: string;
  /** 抓取时间 */
  capturedAt: string;
  /** 一次生成的张数区间 */
  countRange: { min: number; max: number };
  categories: ShoppableCarouselCategory[];
  templates: ShoppableCarouselTemplate[];
}
