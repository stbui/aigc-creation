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
  currency: "CNY" | "USD";
  priceCents: number;
  originalPriceCents: number | null;
  credits: number;
  creditsValidDays: number;
  grantType: "immediate" | "manual";
  status: "active" | "offline";
  sortOrder: number;
  saleStrategy: "unlimited" | "periodic" | "inventory" | "timed";
  periodDays: number;
  periodPurchaseLimit: number;
  stockTotal: number;
  stockReserved: number;
  stockSold: number;
  stockRemaining: number;
  saleStartAt: string | null;
  saleEndAt: string | null;
  /** 后端按服务端时钟派生的售卖状态 */
  saleStatus: "disabled" | "on_sale" | "upcoming" | "ended" | "sold_out";
  canPurchase: boolean;
  orderCount: number; // 历史订单数。> 0 时不可删除，删除前会被提示改为下架
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductPayload {
  sku: string;
  name: string;
  description?: string;
  currency?: "CNY" | "USD";
  priceCents: number;
  originalPriceCents?: number;
  credits: number;
  creditsValidDays?: number;
  grantType?: "immediate" | "manual";
  status?: "active" | "offline";
  sortOrder?: number;
  saleStrategy?: "unlimited" | "periodic" | "inventory" | "timed";
  periodDays?: number;
  periodPurchaseLimit?: number;
  stockTotal?: number;
  saleStartAt?: string | null;
  saleEndAt?: string | null;
}

/**
 * sku 不可改: 历史订单与外部对账都靠它认商品。
 *
 * `originalPriceCents` 允许显式传 null —— 那是「清空划线价」, 与「不改」
 * (不传该字段) 是两件事, 用 undefined 表达不了后者之外的语义。
 */
export type UpdateProductPayload = Partial<Omit<CreateProductPayload, "sku" | "originalPriceCents">> & {
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
  /**
   * 会员等级映射的用户分组编码；空串 = 落 `default` 分组。
   *
   * 分组决定该等级用户可见的渠道与价格倍率。不配的话所有等级都落默认组，
   * 分组倍率与模型级覆盖在真实数据下永不生效，界面上却看不出任何异常。
   */
  userGroupCode: string;
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
  /** 空串 = 落 `default` 分组；非空必须已存在的分组编码 */
  userGroupCode?: string;
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
  /**
   * 退款单状态（列表列）。渠道异步退款时订单仍是 `paid`，
   * 只看订单状态看不出「钱在处理中」，因此单独给出这一列。
   * 无退款单时为 null。
   */
  refundState: 'processing' | 'failed' | 'succeeded' | null;
  grantedCredits: number;
  itemCount: number;
  items: Array<{ name: string; sku: string }>; // 下单时的名称与 SKU 快照
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
  amountCents: number; creditsReclaimed: number; creditsUnreclaimable: number; creditsExpired: number; providerRefundId: string | null;
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
  membershipPlanId: string | null; membershipAppliedAt: string | null;
  membershipPeriodStartAt: string | null; membershipPeriodEndAt: string | null; membershipPeriodRevokedAt: string | null;
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
  paymentOrderId: string | null;
  billingOrderId: string | null;
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
  phoneVerifiedAt: string | null; emailVerifiedAt: string | null; hasPassword: boolean; linkedOAuthProviders: string[];
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  /** 后台重置密码后为 true；前端据此弹出强制改密弹窗 */
  mustChangePassword?: boolean;
  tempPasswordExpiresAt?: string | null;
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
  /** public 对用户可见；internal 只给后台看 */
  visibility?: "public" | "internal";
  createdAt: string;
}

/** GET /admin/tickets/assignees — 可指派的启用后台账号 */
export interface AdminTicketAssignee {
  id: string;
  name: string;
  email: string;
  role: string;
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
