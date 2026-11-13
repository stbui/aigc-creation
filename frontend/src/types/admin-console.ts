import type { AdminUserDetail, CapabilityMode, CapabilityRuntime, TaskStatus } from "./api";

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
  /** 高危权限点 */
  highRiskPermissions: string[];
}

/** GET /api/v1/admin/permissions — 权限点全集与内置角色 */
export interface AdminPermissionCatalog {
  permissions: string[];
  /** 高危权限点 */
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

/** GET /api/v1/admin/workbench — 角色首屏待办 */
export type AdminWorkbenchRoleView = "admin" | "operator" | "finance";
export type AdminWorkbenchSeverity = "critical" | "warning" | "info";
export type AdminWorkbenchGroupKey =
  | "ticket"
  | "task"
  | "refund"
  | "reconciliation"
  | "invoice"
  | "billing"
  | "backup";

export interface AdminWorkbenchItem {
  id: string;
  title: string;
  subtitle: string;
  meta: Array<{ label: string; value: string; tone?: "danger" | "warn" | "muted" }>;
  target: { path: string; intent?: string };
}

export interface AdminWorkbenchGroup {
  key: AdminWorkbenchGroupKey;
  label: string;
  severity: AdminWorkbenchSeverity;
  /** 全量待处理数，不是 items.length */
  count: number;
  amountCents?: number;
  oldestAt?: string;
  link: string;
  items: AdminWorkbenchItem[];
}

export interface AdminWorkbench {
  generatedAt: string;
  roleView: AdminWorkbenchRoleView;
  groups: AdminWorkbenchGroup[];
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
    errorCode: string | null;
    createdAt: string;
    durationMs: number;
    thumbnailUrl: string | null;
  }>;
}

/* ────────────────────────────────────────────────────────────────
   后台: 用户与账户 / 角色权限 / 系统设置
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

/** GET /api/v1/admin/users/stats，跟随当前筛选条件 */
export interface AdminUserStats {
  total: number;
  byRole: Record<string, number>;
  byStatus: Record<string, number>;
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
/** 用户详情定义随用户域类型放在 `admin-users.ts`，此处保留出口避免调用方改路径 */
export type { AdminUserDetail } from './admin-users';

/** POST /api/v1/admin/users/:id/password */
export interface AdminPasswordReset {
  id: string;
  email: string;
  /** 明文仅此一次返回, 不落库 */
  tempPassword: string;
  mustChangePassword: boolean;
  /** 临时密码有效期；过期后用户需重新联系管理员 */
  expiresAt: string;
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
export type AdminSettingValue = string | number | boolean | null;

/** 系统设置写入载荷。`clears` 表示删除运行时覆盖、回落代码默认值 */
export interface AdminSettingsUpdatePayload {
  settings: Record<string, AdminSettingValue>;
  clears?: string[];
}

/** 系统设置写入结果（含逐项 before/after，供页面提示） */
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
      /** 数字项允许显式留空；null 表示“不限” */
      nullable?: boolean;
      min?: number;
      max?: number;
      /** 数字项是否只接受整数 */
      integer?: boolean;
      maxLength?: number;
      /** 允许取值的枚举；存在时渲染下拉而不是自由输入 */
      enum?: number[];
      /** 字符串型可选值白名单；存在时渲染下拉而不是自由输入 */
      options?: string[];
      /** 字符串枚举值的展示文案；键为落库值 */
      optionLabels?: Record<string, string>;
      /** 控件覆盖；缺省为文本输入 */
      control?: "text" | "password" | "image-upload" | "image-formats";
      /** 敏感项：读取接口只返回配置状态，不回显明文 */
      sensitive?: boolean;
      /** 敏感项是否已有加密值 */
      hasSecret?: boolean;
      /** 服务端生成的脱敏提示，仅用于识别已配置值 */
      secretMask?: string | null;
      /** 只读项：真实旋钮在别处，页面只展示当前值并给出跳转 */
      readOnly?: boolean;
      /** 只读项的跳转目标（后台路由） */
      linkTo?: string;
      overridden: boolean;
      group: string;
      updatedBy: string | null;
      updatedAt: string | null;
      /** 图片项的带签名展示地址；保存值本身仍是稳定引用 */
      previewUrl?: string | null;
    }>;
  }>;
}

/** POST /api/v1/admin/settings/upload */
export interface AdminSettingImageUpload {
  /** 稳定存储引用，保存到 payment.helpImage */
  value: string;
  /** 仅供当前页面预览的带签名地址 */
  previewUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
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
  /** 已消耗、无法追回的积分；已过期未使用且无法扣回的积分。都必须如实分类展示 */
  creditsUnreclaimable: number; creditsExpired: number;
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
  /** 支付订单 id（充值 / 购买积分包），与生成账单不是同一张表 */
  paymentOrderId: string | null;
  /** 生成账单 id（任务扣费 / 退款） */
  billingOrderId: string | null;
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

/** 后台「能力与模型」中的能力管控列表行（GET /admin/capabilities） */
export interface AdminCapabilityControl {
  capabilityId: string;
  name: string;
  /** 能力一句话说明，来自后端注册表 */
  summary: string;
  group: string;
  /** 分组中文名，来自后端注册表 */
  groupName: string;
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

