import { API_BASE } from "./constants";
import { API_ROOT, extractErrorMessage, formDataWithFile, unwrapEnvelope } from "./http";
import { clearStoredEmail, clearToken, getToken } from "./auth";
import type {
  AdminBackup,
  AdminBackupStats,
  AdminCleanupLog,
  AdminMe,
  AdminOverview,
  AdminAlertsResult,
  AdminWorkbench,
  AdminPasswordReset,
  AdminPermissionCatalog,
  AdminRoleItem,
  AdminSettings,
  AdminSettingImageUpload,
  AdminSettingsUpdatePayload,
  AdminSettingsUpdateResult,
  AdminAigcLabel,
  AigcLabelSpec,
  AdminUserDetail,
  AdminLoginLogResult,
  AdminUserListResult,
  AdminUserStats,
  AdminAssetListResult,
  AdminAssetStats,
  AdminProjectListResult,
  AdminStorageStatus,
  AssetStatus,
  StorageBackendId,
  AdminTask,
  AdminTaskDetail,
  AdminTaskCongestion,
  AdminTaskListResult,
  AdminCoupon,
  AdminCampaign,
  UpsertCouponPayload,
  UpsertCampaignPayload,
  InviteRule,
  CheckinRule,
  AdminSchedulerStatus,
  AdminInviteListResult,
  AdminCheckinListResult,
  // 交易后台 (B1)
  AdminProduct,
  CreateProductPayload,
  UpdateProductPayload,
  AdminMembershipPlan,
  AdminMembershipPlanList,
  AdminMembershipPlanPayload,
  CreateAdminMembershipPlanPayload,
  AdminOrderListResult,
  AdminOrderDetail,
  AdminCreditListResult,
  AdminCreditLotRow,
  AdminCreditLedgerRow,
  AdminBatchAdjustResult,
  AdminRetentionTarget,
  MyInvites,
  CheckinStatus,
  MarketingQuote,
  PopupCampaign,
  PromoCampaign,
  Asset,
  AssetListResult,
  AssetUploadResponse,
  AuthResponse,
  QrCreateResult,
  QrStatusResult,
  GenerateRequest,
  GenerateResponse,
  LoginRequest,
  Project,
  ProjectListItem,
  AdminProject,
  RegisterRequest,
  SmsLoginRequest,
  SmsPurpose,
  StatsOverview,
  Task,
  TaskListResult,
  TaskPageResult,
  Product,
  ProductsResponse,
  Order,
  OrderListResult,
  CreditBalance,
  CreditLot,
  CreditLedgerEntry,
  CreditLedgerPage,
  SandboxPayResult,
  AdminCreditPrice,
  AdminCapabilityControl,
  MembershipPlan,
  MyMembership,
  PromptToolResult,
  MobileUploadSessionCreated,
  MobileUploadSessionStatus,
  // 账户 / 站内消息 (B4)
  MyProfile,
  DeletionPreview,
  NotificationList,
  MessageTemplateItem,
  DeliveryChannelStatusMap,
  // 工单 / 搜索 / 批量 (B7)
  Ticket,
  TicketListResult,
  CreateTicketPayload,
  AdminTicketListResult,
  AdminTicketDetail,
  AdminTicketAssignee,
  TicketStats,
  BatchSummary,
  CreditImportResult,
  ShoppableCarouselTemplatesResult,
  PortraitTemplatesResult,
} from "../types/api";
import type { AdminUserImpact } from "../types/admin-users";
import type {
  AdminInvoice,
  CreateInvoicePayload,
  Invoice,
  InvoiceStatus,
} from "../types/payment";
import type {
  AdminChannelModelListItem,
  AdminChannelModelView,
  AdminChannelView,
  AdminLogicalModelView,
  ApiLogListResult,
  BillingBatchResolveResult,
  BillingOrderListResult,
  BillingOrderView,
  ChannelHealthRowView,
  ChannelModelFetchResultView,
  ChannelModelHealthRowView,
  ChannelModelRepriceInput,
  ChannelOrderItemView,
  ChannelPageResult,
  FinanceAnalyticsView,
  ModelIntentPayload,
  PluginListResult,
  PluginVerifyResultView,
  PluginView,
  ProviderCatalogView,
  ProviderVerifyResult,
  ProtocolCatalogEntryView,
  ProtocolTestResultView,
  SimulateResultView,
  SystemChannelExportView,
  SystemChannelImportResultView,
  UpstreamModelPreview,
  UserGroupView,
} from "../types/model";

export class ApiError extends Error {
  status: number;
  /** 后端 X-Request-Id / 响应体 requestId —— 供用户报障时提供 */
  requestId: string | null;
  /** 429 时后端给的等待秒数（Retry-After），供按钮做倒计时 */
  retryAfter: number | null;
  /**
   * 后端业务错误码（响应体 `code`），如 40001 / 40905 / 40906。
   *
   * 状态码只能分「400 参数错」与「409 冲突」，**分不清是哪条规则**：
   * 退款金额超上限（40001 硬约束）和超出可配退款规则（40905/40906/40907）
   * 在页面上同形，运营只能看到一句文案。带上业务码才能给出可执行的提示
   * （去调规则 / 改金额）。
   */
  code: number | null;
  constructor(
    message: string,
    status = 0,
    extra: {
      requestId?: string | null;
      retryAfter?: number | null;
      code?: number | null;
    } = {},
  ) {
    super(message);
    this.status = status;
    this.requestId = extra.requestId ?? null;
    this.retryAfter = extra.retryAfter ?? null;
    this.code = extra.code ?? null;
    this.name = "ApiError";
  }
}

const BASE = API_ROOT;

interface RequestOptions {
  method?: string;
  headers?: HeadersInit;
  signal?: AbortSignal | null;
  /** 是否把请求号拼进用户看到的错误文案；后台排障默认保留。 */
  showRequestIdInMessage?: boolean;
  // 具体 DTO 类型 (LoginRequest 等) 没有索引签名, 不能直接赋值给 Record<string, unknown>,
  // 故用 unknown 收口后在运行时 JSON.stringify。
  body?: BodyInit | Record<string, unknown> | object | null;
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let body: BodyInit | null | undefined;
  if (options.body && options.body instanceof FormData) {
    body = options.body;
  } else if (options.body) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  } else {
    body = undefined;
  }

  const res = await fetch(`${BASE}${path}`, {
    method: options.method,
    headers,
    body,
    signal: options.signal,
  });

  // 后端 ResponseInterceptor 把所有成功响应包成 { code: 0, data, message: '' },
  // 必须先剥掉外层信封才能拿到业务数据, 否则每个调用都只拿到 {code,data,message}。
  if (!res.ok) {
    // 401 分两种, 语义完全不同:
    //   a) 本地无 token —— guest 触发了需要身份的动作 (提交/上传/建项目)。
    //      路由已对外开放, 这里不跳登录页, 而是广播 `auth:required` 让 AuthProvider
    //      打开登录弹窗 (与参考站「未登录点生成 → 弹登录框」同构), 并把错误文案改成
    //      「请先登录」, 避免页面上弹一个语义不清的「未认证」。
    //   b) 本地有 token 但失效 —— 清凭证并广播 `auth:unauthorized` 走登出。
    // 登录接口自身的 401 (密码错误) 不算会话失效, 排除。
    if (res.status === 401 && path !== "/auth/login") {
      if (getToken()) {
        clearToken();
        clearStoredEmail();
        window.dispatchEvent(new Event("auth:unauthorized"));
      } else if ((options.method ?? "GET").toUpperCase() !== "GET") {
        /*
         * 只有**用户主动触发的写动作** (提交生成 / 上传 / 建项目) 才弹登录框。
         *
         * 页面加载的读请求 401 不弹: 路由已对外开放, 各页自己渲染未登录空态。
         * 若读请求也弹, guest 一进 /workbench 就被 `stats/overview` 的 401
         * 自动糊一脸登录墙 (实测 /credits 会连弹三组), 与
         * 「guest 不被动弹登录」的契约直接冲突。
         */
        window.dispatchEvent(new Event("auth:required"));
      }
    }
    let message = `请求失败（${res.status}）`;
    let requestId: string | null = res.headers.get("X-Request-Id");
    let bodyCode: unknown;
    try {
      const body = (await res.json()) as Record<string, unknown>;
      bodyCode = body.code;
      message = extractErrorMessage(body, message);
      if (typeof body.requestId === "string") requestId = body.requestId;
    } catch {
      /* 保留默认文案 */
    }
    /*
     * 40302 = 账号被禁用 / 已注销（见后端 jwt-auth.guard）。
     *
     * 这种 403 不是「没权限」，而是会话主体已经不该继续用：token 本身没过期，
     * 后端每次请求都会拒。只处理 401 的话，用户会永远停在「看起来已登录、
     * 但所有请求都失败」的状态。按会话失效处理，清凭证并广播登出。
     */
    if (res.status === 403 && Number(bodyCode) === 40302 && getToken()) {
      clearToken();
      clearStoredEmail();
      window.dispatchEvent(new Event("auth:unauthorized"));
    }
    /*
     * 40303 = 后台重置的临时密码还没改。不是「没权限」，而是会话被限制在
     * /me 与 /me/password；保留 token，广播事件让 AuthProvider 弹出强制改密框。
     */
    if (res.status === 403 && Number(bodyCode) === 40303) {
      window.dispatchEvent(new Event("auth:password-change-required"));
    }
    /*
     * 40304 = 临时密码已过期。此时连 /me/password 都不放行，保留会话只会
     * 让用户停在一个所有请求都失败的状态；按会话失效处理，回登录页。
     */
    if (res.status === 403 && Number(bodyCode) === 40304 && getToken()) {
      clearToken();
      clearStoredEmail();
      window.dispatchEvent(new Event("auth:unauthorized"));
    }
    /*
     * 兜底的「请先登录」只适用于**会话缺失的被动 401**。
     *
     * 登录 / 注册接口的 401 是「凭证错误」（后端 40101 邮箱或密码错误），
     * 之前这里无条件覆盖，导致用户在登录页把密码打错，看到的是
     * 「请先登录」—— 用户本来就以为自己在登录，这个提示自相矛盾，
     * 多数人会以为页面卡住而不是密码错。鉴权入口的 401 原样透出后端文案。
     */
    const isAuthEntry = path.startsWith("/auth/");
    if (res.status === 401 && !getToken() && !isAuthEntry) message = "请先登录";
    /*
     * 5xx 才把请求号拼进文案: 这类错误用户无法自行解决, 报障时必须带上
     * 可检索的 id; 4xx 是用户输入问题, 屏幕上糊一串 uuid 只会干扰。
     * 限流 (429) 单独透出等待秒数, 前端可做倒计时。
     */
    if (
      res.status >= 500 &&
      requestId &&
      options.showRequestIdInMessage !== false
    ) {
      message = `${message}（请求号 ${requestId}）`;
    }
    const retryAfter = Number(res.headers.get("Retry-After") ?? "");
    throw new ApiError(message, res.status, {
      requestId,
      retryAfter:
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      code: Number.isFinite(Number(bodyCode)) ? Number(bodyCode) : null,
    });
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;

  return unwrapEnvelope<T>(JSON.parse(text));
}


/**
 * 商品 (**公开, 免登录**)。
 *
 * 落地页与积分商城的价目唯一来源 —— 不在前端硬编码任何价格。
 * 与 /capabilities 同为公开接口: 用户没登录也要能看到卖什么。
 */
export const productsApi = {
  list: () => request<ProductsResponse>("/products"),
  detail: (sku: string) =>
    request<Product>(`/products/${encodeURIComponent(sku)}`),
};

/**
 * 积分账户 (需登录)。
 *
 * 余额由后端按批次汇总推导 —— 前端不做任何加减, 也不本地缓存余额,
 * 否则会出现"顶导显示 100, 实际已扣光"这类不一致。
 */
export const creditsApi = {
  balance: () => request<CreditBalance>("/credits/balance"),
  lots: () => request<CreditLot[]>("/credits/lots"),
  ledger: (
    params: {
      limit?: number;
      offset?: number;
      type?: string;
      direction?: "income" | "expense";
    } = {},
  ) => {
    const qs = new URLSearchParams();
    qs.set("limit", String(params.limit ?? 50));
    qs.set("offset", String(params.offset ?? 0));
    if (params.type) qs.set("type", params.type);
    if (params.direction) qs.set("direction", params.direction);
    return request<CreditLedgerPage>(`/credits/ledger?${qs.toString()}`);
  },
};

/**
 * 能力消耗价 (后台)。
 *
 * 与 C 端 `/capabilities` 下发的 creditCost 是**同一份数据** ——
 * 后台改价后前者立刻变化, 后者只是把变化传播给前端展示。
 * 两处独立维护必然出现「后台改了、用户看到的没改」。
 */
export const adminCreditPricesApi = {
  list: () => request<AdminCreditPrice[]>("/admin/credit-prices"),
  update: (items: Array<{ capabilityId: string; cost: number }>) =>
    request<{ updated: Array<{ capabilityId: string; cost: number }> }>(
      "/admin/credit-prices",
      {
        method: "PUT",
        body: { items },
      },
    ),
  /** 回落代码默认值 */
  reset: (capabilityId: string) =>
    request<{ capabilityId: string; cost: number }>(
      `/admin/credit-prices/${encodeURIComponent(capabilityId)}/reset`,
      { method: "POST" },
    ),
};

/**
 * 能力上下线（后台「能力与模型」）。
 *
 * 后端要求下架时 reason 非空。页面统一生成一句对 C 端可读的下线提示并随请求
 * 下发，不再让运营手填。
 */
export const adminCapabilitiesApi = {
  list: () => request<AdminCapabilityControl[]>("/admin/capabilities"),

  set: (capabilityId: string, enabled: boolean, reason?: string) =>
    request<{ capabilityId: string; enabled: boolean; reason: string | null }>(
      `/admin/capabilities/${encodeURIComponent(capabilityId)}`,
      { method: "PUT", body: { enabled, reason } },
    ),
};

/**
 * 会员订阅。
 *
 * `plans` **公开免登录** —— 未登录也要能看到订阅价目才能决定买不买。
 * 其余需登录。
 */
export const membershipApi = {
  plans: () => request<MembershipPlan[]>("/membership/plans"),
  /** 单个套餐（含已下架），仅用于续付既有订单 */
  plan: (id: string) =>
    request<MembershipPlan | null>(
      `/membership/plans/${encodeURIComponent(id)}`,
    ),
  me: () => request<MyMembership>("/membership/me"),
  cancel: () =>
    request<{ expiresAt: string }>("/membership/cancel", { method: "POST" }),
};

/**
 * 订单与沙箱支付 (需登录)。
 *
 * ⚠ `idempotencyKey` 由前端生成且**同一次下单重试必须复用同一个 key** ——
 * 后端靠它做幂等, 换 key 会被当成新订单重复建单。CheckoutPage 用 ref 持有。
 */
export const ordersApi = {
  /**
   * 下单。幂等键重复提交返回同一订单。
   *
   * `productId` 与 `membershipPlanId` **二选一** (后端强校验):
   *   · productId        → 积分包/套餐商品 (带 quantity、可用券)
   *   · membershipPlanId → 会员订阅 (金额取套餐价, 不叠加券与折扣)
   */
  create: (params: {
    productId?: string;
    quantity?: number;
    membershipPlanId?: string;
    idempotencyKey: string;
    couponCode?: string;
  }) =>
    request<Order>("/orders", {
      method: "POST",
      body: {
        ...(params.productId
          ? { productId: params.productId, quantity: params.quantity ?? 1 }
          : {}),
        ...(params.membershipPlanId
          ? { membershipPlanId: params.membershipPlanId }
          : {}),
        idempotencyKey: params.idempotencyKey,
        ...(params.couponCode ? { couponCode: params.couponCode } : {}),
      },
    }),
  /** 我的订单（服务端分页，返回 total 与各状态真实计数） */
  list: (params: { limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    qs.set("limit", String(params.limit ?? 20));
    qs.set("offset", String(params.offset ?? 0));
    return request<OrderListResult>(`/orders?${qs.toString()}`);
  },
  detail: (id: string) => request<Order>(`/orders/${id}`),

  /** 关闭未支付订单。已支付订单只能走退款，后端会拒绝 */
  cancel: (id: string) =>
    request<Order>(`/orders/${id}/cancel`, { method: "POST" }),

  /**
   * 沙箱支付。
   *
   * ⚠ 沙箱**不产生真实资金流转**, 仅用于开发联调。真实通道接入后此端点废弃。
   * 页面必须显式标注沙箱身份, 不做假支付 UI 蒙混 (commerce-design.md §6.2)。
   */
  sandboxPay: (id: string, scenario: "success" | "failed" | "timeout") =>
    request<SandboxPayResult>(`/orders/${id}/pay`, {
      method: "POST",
      body: { scenario },
    }),
};

export { paymentsApi } from "./api-payments";

/** 发票 (需登录)。一单一票, 开具后可在后台下载可打印 HTML */
export const invoicesApi = {
  create: (payload: CreateInvoicePayload) =>
    request<Invoice>("/invoices", { method: "POST", body: payload }),

  list: () => request<{ items: Invoice[]; total: number }>("/invoices"),

  detail: (id: string) => request<Invoice>(`/invoices/${id}`),

  /** 在新窗口打开可打印 HTML (带鉴权, 见 openHtmlDocument) */
  preview: (id: string) => openHtmlDocument(`/invoices/${id}/file`),
};

/**
 * 后台管理端接口。
 *
 * 权限判定完全在后端 (AdminGuard + PermissionGuard), 前端持有的权限清单
 * 只用于隐藏无权操作的按钮 —— 不作为安全边界。
 */
export const adminApi = {
  /** 当前后台用户与权限清单。前端刷新后即反映后端的实时变更 */
  me: () => request<AdminMe>("/admin/me"),

  /** 权限点全集与内置角色默认配置 */
  permissions: () => request<AdminPermissionCatalog>("/admin/permissions"),

  /** 平台概览。days 建议只用 7 / 30 / 90, 其它值后端回落到 7 */
  overview: (days: number) =>
    request<AdminOverview>(`/admin/overview?days=${days}`),

  /** 顶栏告警。后端按当前角色权限过滤来源 */
  alerts: () => request<AdminAlertsResult>("/admin/alerts"),

  /**
   * 角色工作台待办。
   *
   * `view` 只允许管理员预览运营/财务首屏；权限过滤始终先执行，视图不放大范围。
   */
  workbench: (view?: "admin" | "operator" | "finance") =>
    request<AdminWorkbench>(`/admin/workbench${view ? `?view=${view}` : ""}`),
};

export function toAbsoluteUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

/**
 * 素材的**可显示**地址（B5）。
 *
 * 后端开启 ASSET_SIGNING_SECRET 后，`/uploads/*` 需要 HMAC 签名；接口会额外
 * 返回 `signedUrl`。这里优先用它，`signedUrl` 为空（签名未开启）时回落到
 * `sourceUrl` —— 于是同一份前端代码在两种模式下都正确。
 *
 * ⚠ 不要直接用 `sourceUrl` 渲染 `<img>`：签名一旦打开，那里会 403。
 * 服务端内部用途（网关拉参考图、删除磁盘文件）仍应使用 `sourceUrl`。
 */
export function assetSrc(
  asset?: { sourceUrl?: string | null; signedUrl?: string | null } | null,
): string | undefined {
  if (!asset) return undefined;
  return toAbsoluteUrl(asset.signedUrl || asset.sourceUrl);
}

/**
 * 素材**缩略图**地址（列表 / 网格用）。
 *
 * 列表卡片只有 200 多像素，原图常见 1–3.5MB —— 首屏 20 张就是几十 MB。
 * 本地存储的 `/uploads/*` 由后端按 `w` / `h` 生成方形 JPEG 并缓存；
 * 云端存储（OSS / MinIO）的 URL 自带签名，追加参数会破坏签名，故原样返回。
 *
 * ⚠ 只用于预览。下载 / 查看原图 / 提交给生成链路仍必须用 `assetSrc()`。
 */
export function assetThumbSrc(
  asset?: {
    sourceUrl?: string | null;
    signedUrl?: string | null;
    storageBackend?: string | null;
  } | null,
  size = 640,
  /** true = 只限宽、保留原图比例（瀑布流/流式布局用，避免方形裁切） */
  preserveAspect = false,
): string | undefined {
  const src = assetSrc(asset);
  if (!src) return undefined;
  if (asset?.storageBackend === "local") return appendThumbParams(src, size, preserveAspect);
  // 明确声明了云端后端: 签名地址追加参数会破坏签名, 原样返回
  if (asset?.storageBackend) return src;
  // 未声明后端 (任务接口的 outputAsset 不带该字段): 按 URL 自身判断是否本地 /uploads
  return assetThumbUrl(src, size, preserveAspect);
}

/**
 * 原始 URL 字符串版本的缩略图地址（后端只给 `thumbnailUrl` 等字符串时用）。
 *
 * 与 `assetThumbSrc()` 同一套语义，但无法得知 `storageBackend`，因此按
 * URL 自身判断：只有落在**本地存储 `/uploads/`** 下才追加 `w` / `h`。
 * 云端（OSS / MinIO）签名地址、`data:` / `blob:` 一律原样返回 ——
 * 追加参数会破坏云端签名。
 *
 * ⚠ 只用于 `<img>` 预览。下载 / 查看原图仍必须用 `toAbsoluteUrl()`。
 */
export function assetThumbUrl(
  url?: string | null,
  size = 640,
  preserveAspect = false,
): string | undefined {
  const abs = toAbsoluteUrl(url);
  if (!abs) return undefined;
  // 相对路径由 toAbsoluteUrl 拼接 API_BASE 得到，已确定指向本服务
  const isOwnUploads =
    abs.startsWith("/uploads/") || abs.startsWith(`${API_BASE}/uploads/`);
  return isOwnUploads ? appendThumbParams(abs, size, preserveAspect) : abs;
}

function appendThumbParams(src: string, size: number, preserveAspect = false): string {
  return `${src}${src.includes("?") ? "&" : "?"}w=${size}${preserveAspect ? "" : `&h=${size}`}`;
}

// ────────────────────────────────────────────────────────────────────
// 交易后台 (B1): 商品 / 订单 / 支付流水 / 积分账本 / 保留期清理
// ────────────────────────────────────────────────────────────────────

/**
 * 把对象拼成 query string, 空值一律跳过 (空串会让后端把筛选条件当成"等于空")。
 *
 * 用泛型约束而非 `Record<...>`: 各查询条件以 `interface` 声明, 而 interface 不会
 * 生成隐式索引签名, 收窄成 Record 会把它们全部挡在门外 (见 `AdminApiLogQuery`)。
 */
export function toQuery<T extends object>(params: T): string {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  });
  return qs.toString() ? `?${qs.toString()}` : "";
}

/**
 * CSV 下载。
 *
 * 独立于 request(): 响应体是 text/csv 而非信封 JSON, 走剥壳逻辑会得到
 * `[object Object]` 或直接抛错。后端已用 @Res() 绕过 ResponseInterceptor,
 * 这里必须同样绕开 unwrapEnvelope。
 *
 * 失败时后端仍返回 JSON 错误体 (权限不足 / 参数非法), 所以先按状态码分流
 * 再决定按 JSON 还是按 blob 读 —— 反过来的话, 一次 403 会存下一个 0 字节文件。
 */
export async function downloadCsv(
  path: string,
  filename?: string,
): Promise<{ truncated: boolean; total: number; limit: number }> {
  const res = await fetch(`${API_ROOT}${path}`, {
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(extractErrorMessage(body, "导出失败"));
  }
  // 后端在截断时通过响应头告知真实总数；浏览器下载 API 读不到响应体元数据，
  // 只能由这里把头上抛给调用方做提示。
  const exportMeta = {
    truncated: res.headers.get("X-Export-Truncated") === "1",
    total: Number(res.headers.get("X-Export-Total") ?? 0),
    limit: Number(res.headers.get("X-Export-Limit") ?? 0),
  };
  // 文件名以后端 Content-Disposition 为准, 没给才用调用方兜底。
  // 优先 filename*=UTF-8''...（RFC 5987，中文文件名正确解码），再退回 ASCII filename。
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const asciiMatch = /filename="?([^";]+)"?/i.exec(disposition);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = utf8Match
    ? decodeURIComponent(utf8Match[1])
    : (asciiMatch?.[1] ?? filename ?? "export.csv");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return exportMeta;
}

/**
 * 带鉴权打开 HTML 文档 (发票预览 / 打印)。
 *
 * 不能直接用 `<a href>`: 发票文件接口要求 Authorization 头, 浏览器新开
 * 标签页不会带上它, 结果是 401 被当成「链接失效」。故先用 fetch 取回
 * Blob 再打开 blob: URL —— 代价是地址栏看不到真实路径, 换来的是可打印。
 */
export async function openHtmlDocument(path: string): Promise<void> {
  const res = await fetch(`${API_ROOT}${path}`, {
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(extractErrorMessage(body, "打开失败"));
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  // 打印/预览可能持续一段时间, 60s 后再回收, 过早回收会让新窗口空白
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export {
  adminPaymentOrdersApi,
  adminPaymentProvidersApi,
  adminPaymentReconciliationApi,
} from "./api-payments";

/** 调用记录的筛选条件：列表与导出共用（导出忽略分页） */
export interface AdminApiLogQuery {
  status?: string;
  requestKind?: string;
  source?: string; operation?: string;
  channelId?: string;
  taskId?: string;
  userId?: string;
  model?: string;
  billable?: string;
  from?: string; to?: string;
}

/** 上游调用记录（`ApiCallLog` 维度，含后台连通性测试的非计费调用） */
export const adminApiLogsApi = {
  list: (
    params: AdminApiLogQuery & { page?: number; pageSize?: number } = {},
  ) => request<ApiLogListResult>(`/admin/api-logs${toQuery(params)}`),

  /**
   * 导出当前筛选结果（CSV，上限 5000 行）。
   *
   * 刻意不含请求体 / 响应体：那是排查用的明细，落成可转发的文件就等于把上游密钥
   * 片段与用户提示词一起散出去。需要看细节走详情抽屉。
   */
  exportCsv: (params: AdminApiLogQuery = {}) =>
    downloadCsv(`/admin/api-logs/export${toQuery(params)}`),
};

/** 财务分析（只读聚合）：实收 / 已退 / 净收入，未结算单独列为挂账 */
export const adminAnalyticsApi = {
  finance: (params: { from?: string; to?: string } = {}) =>
    request<FinanceAnalyticsView>(`/admin/analytics/finance${toQuery(params)}`),
};

export { modelCatalogApi, modelsApi, publicChannelsApi } from "./model-catalog-api";

// 按域拆分后的聚合出口（沿用 api-payments / model-catalog-api 模式）
export { authApi, oauthAuthorizeUrl, projectsApi, assetsApi, generateApi, newIdempotencyKey, statsApi, shoppableCarouselApi, templateApi, promptToolsApi, mobileUploadApi } from "./api-tools";
export type { OAuthProviderInfo, AssetSourceFields } from "./api-tools";
export { adminUsersApi, adminRolesApi, adminSettingsApi, adminAigcLabelApi, adminTasksApi, adminBackupsApi, adminAssetsApi, adminStorageApi, adminTemplateCatalogApi } from "./api-admin-system";
export { marketingApi, myMarketingApi, adminSchedulerApi, adminProductsApi, adminMembershipPlansApi, adminOrdersApi, adminCreditsApi, adminRetentionApi, adminInvoicesApi } from "./api-admin-commerce";
export { meApi, notificationsApi, adminNotificationsApi, ticketsApi, adminTicketsApi } from "./api-account";
export { adminChannelsApi, adminChannelModelsApi, adminLogicalModelsApi, adminUserGroupsApi, adminPluginsApi, adminProviderCatalogApi, adminBillingOrdersApi } from "./api-admin-channels";
