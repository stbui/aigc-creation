import type { AdminTaskRouteAttempt } from './task-route';
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
 * ⚠️ 它是**事前预期**；单次生成实际走的线路以任务快照的
 * `routeId` / `channelModelId` 为准（后台任务详情可查）。
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
  status: "waiting" | "receiving" | "received" | "expired";
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
  status: "waiting" | "receiving" | "received" | "expired";
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
  password: string; emailCode: string;
  name?: string;
  /** 可选手机号。填了必须同时给 smsCode（后端强制校验归属） */
  phone?: string;
  /** 短信验证码，由 POST /auth/sms/send (purpose=verify) 下发 */
  smsCode?: string;
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
  /** 后台重置密码后为 true：登录后必须先在客户端改密 */
  mustChangePassword?: boolean;
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
  ownerId: string;
  createdAt: string;
}

/** GET /projects：项目列表附带当前素材与历史任务计数。 */
export interface ProjectListItem extends Project {
  assetCount: number;
  taskCount: number;
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
   * 模型分组键（`ChannelModel.modelGroupKey`，空则回落到 modelKey）。
   *
   * 必填：具体渠道与线路由服务端在同一能力的候选池里解析。
   */
  modelKey: string;
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
  errorCode?: string | null;
  /**
   * 建任务时选定的模型分组键。
   * 作品页「重新生成」沿用它，保证重试落在与原任务相同的模型上；
   * 存量任务为 null。
   */
  modelKey?: string | null;
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

/** GET /tasks/page?limit=&offset=&capability=&excludeFailed= */
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

/** C 端写真模板条目：预览图 + 名称 + 标签；不含 prompt（商业资产，生成时服务端按 templateId 查回）。 */
export interface TemplateCatalogItem {
  id: string;
  name: string;
  /** 已解析的预览图地址（静态路径或签名/云端地址） */
  thumbFile: string;
  tags: string[];
}

/** 写真模板二级分类（风格 / 场景）。 */
export interface TemplateCatalogGroup {
  id: string;
  slug: string;
  name: string;
  items: TemplateCatalogItem[];
}

/** 写真模板一级分类（对应一篇来源文章 / 一个主题）。 */
export interface TemplateCatalogCategory {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** 来源文章，仅追溯用 */
  sourceUrl: string;
  groups: TemplateCatalogGroup[];
}

/** GET /api/v1/template/templates */
export interface PortraitTemplatesResult {
  categories: TemplateCatalogCategory[];
}

/** 后台模板条目：保留原始图片引用，供编辑回填。 */
export interface AdminTemplateItem {
  id: string;
  groupId: string;
  name: string;
  prompt: string;
  /** `storage://<backend>/<key>` 或站内静态路径 */
  imageUrl: string;
  /** 当前可访问的预览地址 */
  thumbFile: string;
  tags: string[];
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 后台二级分类。 */
export interface AdminTemplateGroup {
  id: string;
  categoryId: string;
  slug: string;
  name: string;
  sortOrder: number;
  enabled: boolean;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  items: AdminTemplateItem[];
}

/** 后台一级分类。 */
export interface AdminTemplateCategory {
  id: string;
  slug: string;
  name: string;
  sourceUrl: string;
  description: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  groups: AdminTemplateGroup[];
}

/** GET /api/v1/admin/templates/catalog */
export interface AdminTemplateCatalog {
  categories: AdminTemplateCategory[];
}

// 按域拆分后的聚合出口
export type { AdminRole, UserStatus, AdminCapabilityMode, AdminMe, AdminPermissionCatalog, AdminAlertSeverity, AdminAlertItem, AdminAlertsResult, AdminWorkbenchRoleView, AdminWorkbenchSeverity, AdminWorkbenchGroupKey, AdminWorkbenchItem, AdminWorkbenchGroup, AdminWorkbench, AdminOverview, AdminUserListResult, AdminUserStats, AdminLoginLogItem, AdminLoginLogResult, AdminPasswordReset, AdminRoleItem, AdminSettingValue, AdminSettingsUpdatePayload, AdminSettingsUpdateResult, AdminSettings, AdminSettingImageUpload, AigcLabelPosition, AigcLabelSpec, AdminAigcLabel, PublicAigcLabel, Modality, Product, ProductsResponse, OrderStatus, OrderItemView, PaymentView, RefundView, OrderListResult, Order, CreditBalance, CreditLot, CreditLedgerEntry, CreditLedgerPage, AdminCapabilityControl, SandboxPayResult, MembershipPlan, MyMembership, AdminUserDetail } from "./admin-console";
export type { AdminTask, AdminTaskCongestion, AdminTaskListResult, AdminTaskDetail, AdminBackup, AdminBackupStats, AdminCleanupLog, StorageBackendId, AssetStatus, AdminAssetListResult, AdminAssetStats, AdminProjectListResult, AdminProject, AdminStorageStatus, CouponType, CouponScope, CouponStatus, CampaignType, CampaignStatus, AdminCoupon, UpsertCouponPayload, AdminCampaign, UpsertCampaignPayload, AdminInviteListResult, AdminCheckinListResult, InviteRule, CheckinRule, MyInvites, CheckinStatus, MarketingQuote, PopupCampaign, PromoCampaign, AdminSchedulerTask, AdminSchedulerStatus } from "./admin-ops";
export type { AdminProduct, CreateProductPayload, UpdateProductPayload, AdminMembershipPerks, AdminMembershipPlan, AdminMembershipPlanList, AdminMembershipPlanPayload, CreateAdminMembershipPlanPayload, AdminOrderStatus, AdminOrderRow, AdminOrderListResult, AdminOrderPayment, AdminOrderRefund, AdminOrderDetail, AdminCreditRow, AdminCreditListResult, AdminCreditLotRow, AdminCreditLedgerRow, AdminBatchAdjustResult, AdminRetentionTarget, MyProfile, DeletionPreview, NotificationItem, NotificationList, MessageTemplateItem, DeliveryChannelStatus, DeliveryChannelStatusMap, BroadcastPayload, BroadcastResult, EmailTestResult, TicketType, TicketStatus, TicketPriority, TicketReplyItem, AdminTicketAssignee, Ticket, TicketListResult, CreateTicketPayload, AdminTicketRow, AdminTicketListResult, AdminTicketDetail, TicketStats, BatchItemResult, BatchSummary, CreditImportResult } from "./admin-support";
