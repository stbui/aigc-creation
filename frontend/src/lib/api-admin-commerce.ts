import { request, toQuery, downloadCsv, openHtmlDocument } from "./api";
import type { AdminBatchAdjustResult, AdminCampaign, AdminCheckinListResult, AdminCleanupLog, AdminCoupon, AdminCreditLedgerRow, AdminCreditListResult, AdminCreditLotRow, AdminInviteListResult, AdminMembershipPlan, AdminMembershipPlanList, AdminMembershipPlanPayload, AdminOrderDetail, AdminOrderListResult, AdminProduct, AdminRetentionTarget, AdminSchedulerStatus, BatchSummary, CheckinRule, CheckinStatus, CreateAdminMembershipPlanPayload, CreateProductPayload, CreditImportResult, InviteRule, MarketingQuote, MyInvites, Order, PopupCampaign, PromoCampaign, UpdateProductPayload, UpsertCampaignPayload, UpsertCouponPayload } from "../types/api";
import type { AdminInvoice, InvoiceStatus } from "../types/payment";

/** 营销中心 (admin-prd.md §3.12 B-64~B67 / M11)；历史订单/会员数据一律保留。 */
export const marketingApi = {
  // ── 优惠券 (B-64) ──────────────────────────────────────────────
  coupons: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<{
      items: AdminCoupon[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/admin/coupons${suffix}`);
  },

  couponDetail: (id: string) => request<AdminCoupon>(`/admin/coupons/${id}`),

  createCoupon: (payload: UpsertCouponPayload) =>
    request<AdminCoupon>("/admin/coupons", { method: "POST", body: payload }),

  updateCoupon: (id: string, payload: UpsertCouponPayload) =>
    request<AdminCoupon>(`/admin/coupons/${id}`, {
      method: "PATCH",
      body: payload,
    }),

  /** 启停切换。停用不影响已核销订单 */
  toggleCoupon: (id: string) => request<AdminCoupon>(`/admin/coupons/${id}/toggle`, { method: "PATCH" }),

  removeCoupon: (id: string) => request<{ id: string; code: string; name: string }>(`/admin/coupons/${id}`, { method: "DELETE" }),

  /** 导出当前筛选结果 (CSV, 上限 5000 行) */
  exportCoupons: (
    params: { keyword?: string; type?: string; status?: string } = {},
  ) => downloadCsv(`/admin/coupons/export${toQuery(params)}`),

  // ── 限时活动 (B-65) ─────────────────────────────────────────────
  campaigns: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<{
      items: AdminCampaign[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/admin/campaigns${suffix}`);
  },

  createCampaign: (payload: UpsertCampaignPayload) =>
    request<AdminCampaign>("/admin/campaigns", {
      method: "POST",
      body: payload,
    }),

  updateCampaign: (id: string, payload: UpsertCampaignPayload) =>
    request<AdminCampaign>(`/admin/campaigns/${id}`, {
      method: "PATCH",
      body: payload,
    }),

  toggleCampaign: (id: string) =>
    request<AdminCampaign>(`/admin/campaigns/${id}/toggle`, {
      method: "PATCH",
    }),

  removeCampaign: (id: string) => request<{ id: string; name: string }>(`/admin/campaigns/${id}`, { method: "DELETE" }),

  /** 导出当前筛选结果 (CSV, 上限 5000 行) */
  exportCampaigns: (
    params: { keyword?: string; type?: string; status?: string; effective?: string } = {},
  ) => downloadCsv(`/admin/campaigns/export${toQuery(params)}`),

  // ── 邀请规则 (B-66) ─────────────────────────────────────────────
  inviteRule: () => request<InviteRule>("/admin/invites/rules"),
  updateInviteRule: (payload: InviteRule) =>
    request<InviteRule>("/admin/invites/rules", {
      method: "PUT",
      body: payload,
    }),

  /** 邀请关系列表 */
  invites: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<AdminInviteListResult>(`/admin/invites${suffix}`);
  },

  /**
   * 手动补发邀请奖励。
   *
   * ⚠ 后端此端点的权限点是 credit.adjust 而非 marketing.write ——
   * 它直接给人发积分, 与后台调整积分同性质。前端按钮须据此隐藏。
   */
  grantInviteReward: (id: string) =>
    request<{ granted: boolean; credits: number }>(
      `/admin/invites/${id}/grant`,
      { method: "POST" },
    ),

  // ── 签到规则 (B-67) ─────────────────────────────────────────────
  checkinRule: () => request<CheckinRule>("/admin/checkin/rules"),
  updateCheckinRule: (payload: CheckinRule) =>
    request<CheckinRule>("/admin/checkin/rules", {
      method: "PUT",
      body: payload,
    }),

  /** 签到记录 (发放量对账用) */
  checkins: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<AdminCheckinListResult>(`/admin/checkin${suffix}`);
  },
};

/**
 * C 端营销接口 (M11)。
 *
 * 与 admin 端的 marketingApi 分开: 权限模型、错误语义、可见字段都不同
 * (如 C 端看不到他人邮箱、看不到券的发行总量)。
 */
export const myMarketingApi = {
  /** 我的邀请码与邀请数据 */
  invites: (params: { limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    qs.set("limit", String(params.limit ?? 20));
    qs.set("offset", String(params.offset ?? 0));
    return request<MyInvites>(`/marketing/invites?${qs.toString()}`);
  },

  /** 绑定邀请关系。注册成功后由前端调用 */
  bindInvite: (inviteCode: string) =>
    request<{ bound: boolean; relationId?: string; reason?: string }>(
      "/marketing/invites/bind",
      {
        method: "POST",
        body: { inviteCode },
      },
    ),

  /** 签到状态 (今日是否已签 / 连签天数 / 未来 7 天可得) */
  checkinStatus: () => request<CheckinStatus>("/marketing/checkin"),

  /** 每日签到。重复调用幂等, 不重复发积分 */
  checkin: () =>
    request<{ alreadyCheckedIn: boolean; credits: number; streak: number }>(
      "/marketing/checkin",
      {
        method: "POST",
      },
    ),

  /** 结算试算。不落库, 可反复调 */
  quote: (payload: {
    productIds: string[];
    quantities: number[];
    couponCode?: string;
  }) =>
    request<MarketingQuote>("/marketing/quote", {
      method: "POST",
      body: payload,
    }),

  /**
   * 促销弹窗位。匿名也能取到 —— 落地页对未登录访客展示促销位是主要转化路径。
   * request() 在无 token 时不发 Authorization 头, 后端 OptionalJwtAuthGuard 放行
   */
  popup: () => request<PopupCampaign | null>("/marketing/popup"),

  /** 进行中的限时活动（落地页「限时活动」页签）。匿名可访问 */
  campaigns: () => request<PromoCampaign[]>("/marketing/campaigns"),
};

/**
 * 定时任务 (B-90)。
 *
 * 手动触发只开放幂等任务 (超时订单关闭/ 积分回收) —— 后端白名单控制,
 * 前端不自行判断哪些能跑。
 */
export const adminSchedulerApi = {
  status: () => request<AdminSchedulerStatus>("/admin/scheduler/status"),

  run: (task: string) =>
    request<{ name: string; skipped?: boolean; reason?: string }>(
      `/admin/scheduler/run?task=${task}`,
      { method: "POST" },
    ),
};

/**
 * 商品管理 (B-34~B-36)。
 *
 * 删除只对没有历史订单的 SKU 开放：退款与积分回收要回查该 SKU 的原价与
 * 发放积分，有订单的商品请下架。后端会再校验一次，前端按 orderCount 先行提示。
 */
export const adminProductsApi = {
  list: (status?: "active" | "offline") => request<AdminProduct[]>(`/admin/products${toQuery({ status })}`),
  create: (payload: CreateProductPayload) => request<AdminProduct>("/admin/products", { method: "POST", body: payload }),

  /** sku 不可改, 故 payload 里没有该字段 */
  update: (id: string, payload: UpdateProductPayload) =>
    request<AdminProduct>(`/admin/products/${id}`, {
      method: "PATCH",
      body: payload,
    }),

  setStatus: (id: string, status: "active" | "offline") =>
    request<{ id: string; status: string }>(`/admin/products/${id}/status`, { method: "PATCH", body: { status } }),
  /** 有历史订单的商品会返回 409，需先改为下架 */
  remove: (id: string) => request<{ id: string; sku: string }>(`/admin/products/${id}`, { method: "DELETE" }),
};

/** 会员套餐管理：C 端价目表的唯一写入入口 */
export const adminMembershipPlansApi = {
  list: () => request<AdminMembershipPlanList>("/admin/membership-plans"),

  create: (payload: CreateAdminMembershipPlanPayload) =>
    request<AdminMembershipPlan>("/admin/membership-plans", {
      method: "POST",
      body: payload,
    }),

  update: (id: string, payload: AdminMembershipPlanPayload) =>
    request<AdminMembershipPlan>(`/admin/membership-plans/${id}`, {
      method: "PATCH",
      body: payload,
    }),

  setStatus: (id: string, status: "active" | "offline") =>
    request<AdminMembershipPlan>(`/admin/membership-plans/${id}/status`, {
      method: "PATCH",
      body: { status },
    }),

  remove: (id: string) => request<{ id: string; code: string; name: string }>(`/admin/membership-plans/${id}`, { method: "DELETE" }),
};

/** 订单管理 (B-39~B-44) */
export const adminOrdersApi = {
  list: (
    params: {
      status?: string;
      orderNo?: string;
      email?: string;
      channel?: string;
      /** processing / failed / succeeded —— 退款状态挂在 Refund 行上 */
      refundState?: string;
      /** 商品维度：只回买过该商品的订单（商品卡「N 单」深链） */
      productId?: string;
      from?: string;
      to?: string;
      userId?: string;
      page?: number;
      pageSize?: number;
      sort?: string;
    } = {},
  ) => request<AdminOrderListResult>(`/admin/orders${toQuery(params)}`),

  detail: (id: string) => request<AdminOrderDetail>(`/admin/orders/${id}`),

  exportCsv: (
    params: {
      status?: string;
      orderNo?: string;
      email?: string;
      channel?: string;
      refundState?: string;
      productId?: string;
      from?: string;
      to?: string;
    } = {},
  ) => downloadCsv(`/admin/orders/export${toQuery(params)}`),

  /**
   * 手工核销: 线下转账/渠道掉单时由财务确认。
   *
   * 幂等 —— 重复点击返回 idempotentHit=true 而非重复发积分。
   * 交易号用 `MANUAL-<管理员>-<时间戳>` 由后端生成, 不与渠道流水混在一起。
   *
   * `note` 是核销依据（线下转账凭证号 / 渠道商户后台查到的交易号）。人工入账
   * 没有渠道报文，这段文字会写进支付流水并在详情里展示，是事后唯一的凭据。
   */
  markPaid: (id: string, note?: string) =>
    request<{ order: Order; idempotentHit: boolean; message?: string }>(
      `/admin/orders/${id}/mark-paid`,
      { method: "POST", body: note?.trim() ? { note: note.trim() } : {} },
    ),

  /**
   * 退款。金额不得超过实付 - 已退, 原因必填 (后端校验)。
   *
   * 2026-10-22 起退款会**真的调渠道** (`alipay.trade.refund` /
   * 微信 v3 refunds)。故返回值多了一个 `state`:
   *   succeeded  渠道已退 — credits 字段才是真结果
   *   processing 渠道受理但异步处理中 — 订单与积分**都没动**, 需人工到渠道后台确认
   *
   * 渠道失败时后端抛 502 (50302), 这里走 catch, 不会返回本结构。
   *
   * 返回里区分 creditsReclaimed / creditsUnreclaimable / creditsExpired：已消耗和已过期未使用的份额都扣不回来，必须分别展示。
   */
  refund: (id: string, amountCents: number, reason: string) =>
    request<{
      refundId: string;
      state: "succeeded" | "processing";
      pending: boolean;
      refundedCents: number;
      fullyRefunded: boolean;
      creditsReclaimed: number;
      creditsUnreclaimable: number; creditsExpired: number;
      membershipTerminated: boolean;
      invoiceFollowUp: { invoiceId: string; invoiceNo: string; status: "pending" | "issued"; message: string } | null; message?: string;
    }>(`/admin/orders/${id}/refund`, {
      method: "POST",
      body: { amountCents, reason },
    }),

  /** 批量核销。 */
  batchMarkPaid: (ids: string[]) =>
    request<BatchSummary<{ orderId: string; idempotentHit: boolean }>>(
      "/admin/orders/batch",
      {
        method: "POST",
        body: { ids, action: "mark_paid" },
      },
    ),
};

/**
 * 支付流水 (B-45)。只读 —— 钱的动作一律在订单上做, 流水是既成事实。
 *
 * 旧实现请求 `/admin/payments` 与 `/admin/payments/export`，后端支付域重构后
 * 这两条路径已不存在（改为 `/admin/payments/orders*`），故移除；
 * 支付订单改用 `adminPaymentOrdersApi`。
 */

/** 积分账本 (B-49~B-52) */
export const adminCreditsApi = {
  list: (
    params: {
      userId?: string;
      email?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) => request<AdminCreditListResult>(`/admin/credits${toQuery(params)}`),

  lots: (userId: string, params: { from?: string; to?: string } = {}) =>
    request<AdminCreditLotRow[]>(
      `/admin/credits/${userId}/lots${toQuery(params)}`,
    ),

  ledger: (
    userId: string,
    params: { type?: string; from?: string; to?: string; limit?: number } = {},
  ) =>
    request<AdminCreditLedgerRow[]>(
      `/admin/credits/${userId}/ledger${toQuery(params)}`,
    ),

  /** 人工调整。备注可选；流水会记录调整人、备注与余额变动。 */
  adjust: (payload: { userId: string; delta: number; reason?: string; validDays?: number; idempotencyKey?: string }) =>
    request<{ userId: string; balance: number; delta: number }>(
      "/admin/credits/adjust",
      {
        method: "POST",
        body: payload,
      },
    ),

  /**
   * 批量调整。逐条独立执行, 返回每条结果 (一条失败不影响其余)。
   *
   * `idempotencyKey` 由调用方在打开抽屉时生成一次并复用：超时重试时
   * 已成功的行会命中幂等键，不会二次发放。
   */
  batchAdjust: (payload: {
    items: Array<{ userId: string; delta: number; reason?: string }>;
    reason?: string;
    idempotencyKey?: string;
    validDays?: number;
  }) =>
    request<AdminBatchAdjustResult>("/admin/credits/batch-adjust", {
      method: "POST",
      body: payload,
    }),

  exportCsv: (params: { userId?: string; email?: string } = {}) =>
    downloadCsv(`/admin/credits/export${toQuery(params)}`),

  /**
   * CSV 导入发放/扣减积分。列格式 `email,delta[,reason]`。
   *
   * multipart 上传: 走 FormData 而不是 JSON —— 运营手里的就是 Excel 导出的
   * 文件, 让他们自己转成 JSON 等于逼人在本地写脚本。
   */
  importCsv: (file: File, opts: { validDays?: number; importKey?: string } = {}) => {
    const form = new FormData();
    form.append("file", file);
    if (opts.validDays !== undefined)
      form.append("validDays", String(opts.validDays));
    // 导入幂等键：同一文件重试不二次发放
    if (opts.importKey) form.append("importKey", opts.importKey);
    return request<CreditImportResult>("/admin/credits/import", {
      method: "POST",
      body: form,
    });
  },
};

/** 保留期清理 (B-96)。所有清理入口统一走这里。 */
export const adminRetentionApi = {
  targets: () => request<AdminRetentionTarget[]>("/admin/retention/targets"),

  preview: (target: string, retentionDays: number) =>
    request<AdminRetentionTarget>(
      `/admin/retention/preview${toQuery({ target, retentionDays })}`,
    ),

  logs: (pageSize = 50) =>
    request<AdminCleanupLog[]>(`/admin/retention/logs?pageSize=${pageSize}`),

  cleanup: (target: string, retentionDays: number) =>
    request<{ target: string; deleted: number; cutoff: string }>(
      "/admin/retention/cleanup",
      {
        method: "POST",
        body: { target, retentionDays },
      },
    ),
};

/**
 * 后台发票审核 (B3)。权限 invoice.write。
 *
 * 驳回必须给原因 —— 退回说明会展示给用户。
 */
export const adminInvoicesApi = {
  list: (
    params: {
      status?: InvoiceStatus;
      keyword?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) =>
    request<{ items: AdminInvoice[]; total: number }>(
      `/admin/invoices${toQuery(params)}`,
    ),

  issue: (id: string) =>
    request<AdminInvoice>(`/admin/invoices/${id}/issue`, { method: "POST" }),

  reject: (id: string, reason: string) =>
    request<AdminInvoice>(`/admin/invoices/${id}/reject`, {
      method: "POST",
      body: { reason },
    }),

  /** 导出当前筛选结果 (CSV, 上限 5000 行) */
  exportCsv: (params: { status?: InvoiceStatus; keyword?: string } = {}) =>
    downloadCsv(`/admin/invoices/export${toQuery(params)}`),

  preview: (id: string) => openHtmlDocument(`/admin/invoices/${id}/file`),
};
