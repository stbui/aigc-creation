import { API_BASE } from "./constants";
import { API_ROOT, extractErrorMessage, unwrapEnvelope } from "./http";
import { clearStoredEmail, clearToken, getToken } from "./auth";
import type {
  AdminAuditListResult,
  AdminBackup,
  AdminBackupStats,
  AdminCleanupLog,
  AdminMe,
  AdminOverview,
  AdminAlertsResult,
  AdminPasswordReset,
  AdminPermissionCatalog,
  AdminRoleItem,
  AdminSettings,
  AdminSettingsUpdatePayload,
  AdminSettingsUpdateResult,
  AdminAigcLabel,
  AigcLabelSpec,
  AdminUserDetail,
  AdminLoginLogResult,
  AdminUserListResult,
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
  PaymentIntent,
  PaymentProviderInfo,
  PaymentStatusResult,
  Invoice,
  InvoiceStatus,
  CreateInvoicePayload,
  AdminInvoice,
  AdminCreditPrice,
  AdminCapabilityControl,
  MembershipPlan,
  MyMembership,
  PromptToolResult,
  MobileUploadSessionCreated,
  MobileUploadSessionStatus,
  // 账户 / 法务 / 站内消息 (B4)
  LegalDoc,
  LegalIndexItem,
  AdminLegalDoc,
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
  TicketStats,
  AdminSearchResult,
  BatchSummary,
  CreditImportResult,
  ShoppableCarouselTemplatesResult,
} from "../types/api";
import type { AdminUserImpact } from "../types/admin-users";
import type {
  AdminPageResult,
  AdminPaymentOrderDetail,
  AdminPaymentOrderRow,
  AdminPaymentProductView,
  AdminPaymentProviderView,
  AdminPaymentSettings,
  AdminReconciliationItem,
  AdminReconciliationRun,
  PaymentCurrency,
  PaymentProductInput,
  PaymentProviderConfigUpdate,
  PaymentProviderId,
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
  ModelQuoteView,
  PluginListResult,
  PluginVerifyResultView,
  PluginView,
  ProviderCatalogView,
  ProviderVerifyResult,
  ProtocolCatalogEntryView,
  ProtocolTestResultView,
  PublicChannelView,
  PublicModelCatalogResult,
  SimulateResultView,
  SystemChannelExportView,
  SystemChannelImportResultView,
  UpstreamModelPreview,
  UserGroupView,
} from "../types/model";
import type { PublicLogicalModel } from "./models";

export class ApiError extends Error {
  status: number;
  /** 后端 X-Request-Id / 响应体 requestId —— 供用户报障时提供 */
  requestId: string | null;
  /** 429 时后端给的等待秒数（Retry-After），供按钮做倒计时 */
  retryAfter: number | null;
  constructor(
    message: string,
    status = 0,
    extra: { requestId?: string | null; retryAfter?: number | null } = {},
  ) {
    super(message);
    this.status = status;
    this.requestId = extra.requestId ?? null;
    this.retryAfter = extra.retryAfter ?? null;
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
    });
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;

  return unwrapEnvelope<T>(JSON.parse(text));
}

function asList<T>(res: TaskListResult | undefined): T[] {
  if (!res) return [];
  if (Array.isArray(res)) return res as T[];
  return [];
}

export interface OAuthProviderInfo {
  id: string;
  name: string;
  enabled: boolean;
}

export const authApi = {
  login: (data: LoginRequest) =>
    request<AuthResponse>("/auth/login", { method: "POST", body: data }),
  register: (data: RegisterRequest) =>
    request<AuthResponse>("/auth/register", { method: "POST", body: data }),

  /**
   * 申请密码重置邮件。
   *
   * 后端**恒返回成功**（防账号枚举），前端文案必须是
   * 「如果该邮箱已注册，重置链接已发送」—— 不能承诺「已发送」。
   */
  forgotPassword: (email: string) =>
    request<{ requested: true }>("/auth/password/forgot", {
      method: "POST",
      body: { email },
    }),

  /** 用邮件里的一次性令牌重置密码；成功后旧会话全部失效 */
  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>("/auth/password/reset", {
      method: "POST",
      body: { token, password },
    }),

  /** 发送短信验证码。`delivered=false` 表示走了控制台通道（未真实投递） */
  sendSms: (phone: string, purpose: SmsPurpose) =>
    request<{ sent: true; delivered: boolean }>("/auth/sms/send", {
      method: "POST",
      body: { phone, purpose },
    }),

  smsLogin: (data: SmsLoginRequest) =>
    request<AuthResponse>("/auth/sms/login", { method: "POST", body: data }),

  /*
   * 扫码登录（B8）。四步：
   *   create  桌面建码，拿到票据（只此一次，不落库明文）
   *   status  桌面轮询；状态 confirmed 的那一次响应里带 accessToken
   *   scan    手机（已登录）扫码，只标记已扫描
   *   confirm 手机确认，唯一真正绑定账号的一步
   */

  qrCreate: () =>
    request<QrCreateResult>("/auth/qr/create", { method: "POST" }),

  qrStatus: (ticket: string) =>
    request<QrStatusResult>(
      `/auth/qr/status?ticket=${encodeURIComponent(ticket)}`,
    ),

  qrScan: (ticket: string) =>
    request<QrStatusResult>("/auth/qr/scan", {
      method: "POST",
      body: { ticket },
    }),

  qrConfirm: (ticket: string, approve: boolean) =>
    request<QrStatusResult>("/auth/qr/confirm", {
      method: "POST",
      body: { ticket, approve },
    }),

  /** 通用 OAuth：列出已启用的 provider，登录页据此渲染按钮 */
  oauthProviders: () => request<OAuthProviderInfo[]>("/auth/oauth/providers"),

  /** OAuth 回调拿到短时 ticket 后换取正式会话 */
  oauthComplete: (ticket: string) =>
    request<AuthResponse>("/auth/oauth/complete", {
      method: "POST",
      body: { ticket },
    }),
};

/** OAuth 授权跳转地址。浏览器直接导航，不经过 fetch */
export function oauthAuthorizeUrl(
  providerId: string,
  returnTo?: string,
): string {
  const params = new URLSearchParams();
  if (returnTo) params.set("returnTo", returnTo);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return `${API_ROOT}/auth/oauth/${encodeURIComponent(providerId)}/authorize${suffix}`;
}

export const projectsApi = {
  list: () =>
    request<TaskListResult>("/projects").then((r) => asList<Project>(r)),
  create: (name: string) =>
    request<Project>("/projects", { method: "POST", body: { name } }),
};

/** 采集来源元数据 (浏览器扩展上传时提交, 站点内上传不需要) */
export interface AssetSourceFields {
  sourceSite?: string;
  sourceTitle?: string;
  sourcePageUrl?: string;
}

export const assetsApi = {
  // projectId 必传: 后端 assets.service.ts:21 校验缺失即 400
  upload: (file: File, projectId: string, source: AssetSourceFields = {}) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("projectId", projectId);
    if (source.sourceSite) fd.append("sourceSite", source.sourceSite);
    if (source.sourceTitle) fd.append("sourceTitle", source.sourceTitle);
    if (source.sourcePageUrl) fd.append("sourcePageUrl", source.sourcePageUrl);
    return request<AssetUploadResponse>("/assets/upload", {
      method: "POST",
      body: fd,
    });
  },

  /** 批量移动素材到另一项目 (分组); 只改素材归属, 不动生成任务的历史记录 */
  move: (ids: string[], projectId: string) =>
    request<{ moved: number; missing: string[]; projectId: string }>(
      "/assets/move",
      {
        method: "PATCH",
        body: { ids, projectId },
      },
    ),

  /** 读取单个素材。历史提交恢复需要用它找回当时使用的模板与参考图。 */
  get: (id: string) => request<Asset>(`/assets/${id}`),

  /** 素材库列表: kind=original|generated, capability 过滤, 分页 */
  list: (
    params: {
      kind?: string;
      capability?: string;
      limit?: number;
      offset?: number;
      /** 关键词: 按素材地址片段匹配 (参考站 picker 的搜索框) */
      keyword?: string;
      /** 起始日期 (含当天) */
      from?: string;
      /** 截止日期 (含当天) */
      to?: string;
    } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.kind) qs.set("kind", params.kind);
    if (params.capability) qs.set("capability", params.capability);
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.offset !== undefined) qs.set("offset", String(params.offset));
    if (params.keyword) qs.set("keyword", params.keyword);
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<AssetListResult>(`/assets${suffix}`);
  },

  /** 删除素材 (生成图会连带删除产出它的任务) */
  remove: (id: string) =>
    request<{ id: string; removedTasks: number }>(`/assets/${id}`, {
      method: "DELETE",
    }),
};

export const generateApi = {
  start: (data: GenerateRequest) => {
    const idempotencyKey = data.idempotencyKey || newIdempotencyKey();
    return request<GenerateResponse>("/generate", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: { ...data, idempotencyKey },
    });
  },
  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  list: () => request<TaskListResult>("/tasks").then((r) => asList<Task>(r)),
  /** 分页任务列表（作品页 / 结果栏用，避免拉全量） */
  listPage: (
    params: {
      limit?: number;
      offset?: number;
      capability?: string;
      projectId?: string;
    } = {},
  ) => {
    const qs = new URLSearchParams();
    qs.set("limit", String(params.limit ?? 50));
    qs.set("offset", String(params.offset ?? 0));
    if (params.capability) qs.set("capability", params.capability);
    if (params.projectId) qs.set("projectId", params.projectId);
    return request<TaskPageResult>(`/tasks/page?${qs.toString()}`);
  },
  remove: (id: string) =>
    request<{ id: string; removedAsset: boolean }>(`/tasks/${id}`, {
      method: "DELETE",
    }),
};

/** 浏览器端幂等键；不支持 randomUUID 的旧内核仍生成足够随机的回退值。 */
export function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function")
    return cryptoApi.randomUUID();
  const random = () => Math.random().toString(36).slice(2, 12);
  return `gen-${Date.now().toString(36)}-${random()}-${random()}`;
}

export const statsApi = {
  overview: () => request<StatsOverview>("/stats/overview"),
};

/**
 * AI 带货图文模板清单 (公开, 免登录)。
 *
 * 模板是能力定义的一部分 (决定提示词的三拍结构), 事实源在后端
 * `capabilities/definitions/shoppable-carousel.templates.ts`。
 * 前端不另存一份清单 —— 两份清单漂移时, 用户选中的模板会与后端查不到的
 * 那份对不上, 表现为「版式不对但看不出原因」。
 *
 * 缩略图是**本仓库内的静态文件**, 接口只给相对路径, 运行时不请求外部站点。
 */
export const shoppableCarouselApi = {
  templates: () =>
    request<ShoppableCarouselTemplatesResult>("/shoppable-carousel/templates"),
};

/**
 * 提示词工具 (AI润色 / 图片转提示词)。
 *
 * ⚠️ 这两个接口**产出的是文字, 不是图片** —— 故不叫 generateApi, 也不进
 * 任务轮询体系。前端拿到的是一段可直接填进提示词框的文本。
 *
 * 需登录: 参考站这两个入口在未登录时弹登录框。
 */
export const promptToolsApi = {
  /** AI 润色。textOnly=true 表示只改措辞, 不增删画面要素 */
  polish: (text: string, textOnly = false) =>
    request<PromptToolResult>("/prompt-tools/polish", {
      method: "POST",
      // 前台只给自然语言提示；请求号仍保留在 ApiError 中供日志关联。
      showRequestIdInMessage: false,
      body: { text, textOnly },
    }),

  /** 图片转提示词。传站内素材 id, 不传图片本体 */
  imageToPrompt: (assetId: string, extra?: string) =>
    request<PromptToolResult>("/prompt-tools/image-to-prompt", {
      method: "POST",
      showRequestIdInMessage: false,
      body: { assetId, ...(extra ? { extra } : {}) },
    }),
};

/**
 * 手机上传会话 (二维码方案)。
 *
 * 三段式: 电脑端建会话 → 手机端凭令牌传图 → 电脑端轮询取回。
 * 手机端不登录, 凭 sessionId + token 授权。
 */
export const mobileUploadApi = {
  /** 电脑端: 创建会话 */
  create: (projectId: string) =>
    request<MobileUploadSessionCreated>("/mobile-upload/sessions", {
      method: "POST",
      body: { projectId },
    }),

  /** 电脑端: 轮询会话状态 */
  status: (sessionId: string) =>
    request<MobileUploadSessionStatus>(
      `/mobile-upload/sessions/${encodeURIComponent(sessionId)}`,
    ),

  /** 电脑端: 取消会话 */
  cancel: (sessionId: string) =>
    request<{ ok: boolean }>(
      `/mobile-upload/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
      },
    ),

  /**
   * 手机端: 上传图片 (免登录, 凭令牌)。
   *
   * ⚠️ 该接口**不能带 Authorization 头** —— 手机端没登录。
   * 故单独走 fetch 而非共用 request() (后者会无条件附加本地 token)。
   *
   * 支持一次多张 (2026-10-20 对齐参考站手机端): 文件按数组顺序追加,
   * 顺序即电脑端参考图位的构图顺序。
   */
  receive: (sessionId: string, token: string, files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append("file", f);
    fd.append("token", token);
    return request<{
      ok: boolean;
      status: string;
      assetId: string | null;
      assets: Array<{ id: string; url: string; filename: string }>;
    }>(`/mobile-upload/sessions/${encodeURIComponent(sessionId)}/receive`, {
      method: "POST",
      body: fd,
    });
  },
};

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
 * 能力上下线（后台「能力管控」）。
 *
 * 下架必须填原因 —— 原因会展示给 C 端用户并进审计。只写「已下线」
 * 会让用户去问客服，写清「云端通道维护中」才是可自助的。
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

/**
 * 支付通道 (B3, 需登录)。
 *
 * 与 `ordersApi.sandboxPay` 的分工: 沙箱仍是站内模拟; 真实通道
 * (支付宝/微信) 走 `intent` 拿跳转地址或二维码, 到账由渠道回调驱动,
 * 前端只负责轮询 `status`。
 *
 * ⚠ 通道未配置凭据时 `intent` 返回 503 —— 界面必须如实提示「支付通道
 * 暂不可用」, 不能回落到沙箱装作成功。
 */
export const paymentsApi = {
  /** C 端支付设置：默认币种 + 该币种下可用渠道（公开） */
  settings: () =>
    request<{ defaultCurrency: string; providers: PaymentProviderInfo[] }>(
      "/payments/settings",
    ),

  /**
   * 当前可用支付渠道。
   *
   * 后端在可用渠道 > 1 时要求 `intent` 显式传 providerId；不拉列表就无法
   * 让用户选择，最终只能拿到 400「存在多个可用支付渠道」。
   */
  providers: (currency?: string) => {
    const qs = currency ? `?currency=${encodeURIComponent(currency)}` : "";
    return request<{ items: PaymentProviderInfo[]; total: number }>(
      `/payments/providers${qs}`,
    );
  },

  intent: (orderId: string, providerId?: string) =>
    request<PaymentIntent>(`/payments/${orderId}/intent`, {
      method: "POST",
      body: providerId ? { providerId } : {},
    }),

  status: (orderId: string) =>
    request<PaymentStatusResult>(`/payments/${orderId}/status`),

  /**
   * 用户主动查单。
   *
   * 与 `status` 共用同一后端结果，但 POST 会绕过状态轮询的 2 秒节流，
   * 用于“我已完成支付”以及渠道同步跳回后的立即确认。
   */
  query: (orderId: string) =>
    request<PaymentStatusResult>(`/payments/${orderId}/query`, {
      method: "POST",
    }),
};

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
): string | undefined {
  const src = assetSrc(asset);
  if (!src) return undefined;
  if (asset?.storageBackend === "local") return appendThumbParams(src, size);
  // 明确声明了云端后端: 签名地址追加参数会破坏签名, 原样返回
  if (asset?.storageBackend) return src;
  // 未声明后端 (任务接口的 outputAsset 不带该字段): 按 URL 自身判断是否本地 /uploads
  return assetThumbUrl(src, size);
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
): string | undefined {
  const abs = toAbsoluteUrl(url);
  if (!abs) return undefined;
  // 相对路径由 toAbsoluteUrl 拼接 API_BASE 得到，已确定指向本服务
  const isOwnUploads =
    abs.startsWith("/uploads/") ||
    (Boolean(API_BASE) && abs.startsWith(`${API_BASE}/uploads/`));
  return isOwnUploads ? appendThumbParams(abs, size) : abs;
}

function appendThumbParams(src: string, size: number): string {
  return `${src}${src.includes("?") ? "&" : "?"}w=${size}&h=${size}`;
}

/**
 * 用户与账户管理。
 * 高危动作 (禁用/角色/重置密码/删除) 均对应独立权限点, 便于单独回收。
 */
export const adminUsersApi = {
  list: (
    params: {
      keyword?: string;
      role?: string;
      status?: string;
      page?: number;
      pageSize?: number;
      sort?: string;
    } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.keyword) qs.set("keyword", params.keyword);
    if (params.role) qs.set("role", params.role);
    if (params.status) qs.set("status", params.status);
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    if (params.sort) qs.set("sort", params.sort);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<AdminUserListResult>(`/admin/users${suffix}`);
  },

  detail: (id: string) => request<AdminUserDetail>(`/admin/users/${id}`),
  /** 最近登录记录。权限 audit.read —— 无权限时 403，前端按「不可见」处理 */
  logins: (id: string, limit = 50) =>
    request<AdminLoginLogResult>(`/admin/users/${id}/logins?limit=${limit}`),

  /** 删除前的连带影响预览, 供确认弹窗展示具体数量 */
  impact: (id: string) => request<AdminUserImpact>(`/admin/users/${id}/impact`),

  changeStatus: (id: string, status: "active" | "disabled") =>
    request<{ id: string; status: string }>(`/admin/users/${id}/status`, {
      method: "PATCH",
      body: { status },
    }),

  changeRole: (id: string, role: string) =>
    request<{ id: string; role: string; roleLabel: string }>(
      `/admin/users/${id}/role`,
      {
        method: "PATCH",
        body: { role },
      },
    ),

  /** 返回一次性临时密码明文 —— 关闭后不可再次查看 */
  resetPassword: (id: string) =>
    request<AdminPasswordReset>(`/admin/users/${id}/password`, {
      method: "POST",
    }),

  /** 默认软注销; hard=true 物理删除, 仅限无资金记录的账号 */
  remove: (id: string, hard = false, confirm?: string) =>
    request<{
      id: string;
      hard: boolean;
      deleted?: { projects: number; tasks: number; assets: number };
      removedFiles?: number;
      failedFiles?: number;
    }>(`/admin/users/${id}${hard ? "?hard=true" : ""}`, {
      method: "DELETE",
      body: { confirm },
    }),

  /** 导出当前筛选结果 (CSV, 上限 5000 行) */
  exportCsv: (
    params: {
      keyword?: string;
      role?: string;
      status?: string;
      from?: string;
      to?: string;
    } = {},
  ) => downloadCsv(`/admin/users/export${toQuery(params)}`),

  /** 批量启用/禁用。逐条结果 —— 一条失败不影响其余 */
  batch: (ids: string[], action: "disable" | "enable") =>
    request<BatchSummary<{ id: string; status: string }>>(
      "/admin/users/batch",
      {
        method: "POST",
        body: { ids, action },
      },
    ),
};

/** 角色权限 */
export const adminRolesApi = {
  list: () => request<{ items: AdminRoleItem[] }>("/admin/roles"),

  updatePermissions: (roles: Array<{ code: string; permissions: string[] }>) =>
    request<{ roles: Array<{ code: string; permissions: string[] }> }>(
      "/admin/roles",
      {
        method: "PATCH",
        body: { roles },
      },
    ),
};

/** 系统设置 (扁平结构提交, 字段名见后端 FIELD_TO_SETTING_KEY) */
export const adminSettingsApi = {
  read: () => request<AdminSettings>("/admin/settings"),
  update: (payload: AdminSettingsUpdatePayload) =>
    request<AdminSettingsUpdateResult>("/admin/settings", {
      method: "PATCH",
      body: payload,
    }),
};

/**
 * AIGC 可见角标样式。
 *
 * `badgePngBase64` 由后台页面用 Canvas 按 spec 渲染，服务端只负责合成。
 * 两者一起提交的原因见后端 `AigcLabelService.save`：分两次写会出现
 * 「文案已改、图上还是旧字」的中间态。
 */
export const adminAigcLabelApi = {
  read: () => request<AdminAigcLabel>("/admin/aigc-label"),
  update: (payload: { spec: AigcLabelSpec; badgePngBase64: string }) =>
    request<AdminAigcLabel>("/admin/aigc-label", {
      method: "PUT",
      body: payload,
    }),
};

/**
 * 任务监控 (admin-prd.md B-28~B-33)。
 *
 * 重试与终止是**写操作**, 与只读的列表/详情分开放, 便于调用点自检:
 * 误把 retry 当查询调用的代价是真跑一次生成。
 */
export const adminTasksApi = {
  list: (
    params: {
      page?: number;
      pageSize?: number;
      status?: string;
      capability?: string;
      provider?: string;
      userId?: string;
      projectId?: string;
      from?: string;
      to?: string;
      sort?: string;
    } = {},
  ) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<AdminTaskListResult>(`/admin/tasks${suffix}`);
  },

  /** 拥堵指标。独立拉取以便高频刷新告警条而不重载整页列表 */
  stats: () => request<AdminTaskCongestion>("/admin/tasks/stats"),

  /** 导出当前筛选结果 (CSV, 上限 5000 行) */
  exportCsv: (
    params: {
      status?: string;
      capability?: string;
      provider?: string;
      userId?: string;
      projectId?: string;
      from?: string;
      to?: string;
    } = {},
  ) => downloadCsv(`/admin/tasks/export${toQuery(params)}`),

  detail: (id: string) => request<AdminTaskDetail>(`/admin/tasks/${id}`),

  /** 失败重试: 后端新建任务而非原地复活, 返回新任务 id */
  retry: (id: string) =>
    request<{ taskId: string; retriedFromId: string }>(
      `/admin/tasks/${id}/retry`,
      {
        method: "POST",
      },
    ),

  /** 终止等待中/执行中的任务。 */
  cancel: (id: string) =>
    request<{ id: string; status: string; errorCode: string }>(
      `/admin/tasks/${id}/cancel`,
      {
        method: "POST",
      },
    ),

  /** 删除任务及其产出。仅已结束任务可删 */
  remove: (id: string) =>
    request<{ id: string; removedAsset: boolean }>(`/admin/tasks/${id}`, {
      method: "DELETE",
    }),

  /** 批量重试 / 终止 / 删除。状态限制逐条生效，失败原因逐条回传 */
  batch: (ids: string[], action: "retry" | "cancel" | "delete") =>
    request<BatchSummary<unknown>>("/admin/tasks/batch", {
      method: "POST",
      body: { ids, action },
    }),
};

/** 操作审计 (只读, 后端无删除接口) */
export const adminAuditApi = {
  list: (
    params: {
      actorId?: string;
      action?: string;
      targetId?: string;
      success?: boolean;
      page?: number;
      pageSize?: number;
    } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.actorId) qs.set("actorId", params.actorId);
    if (params.action) qs.set("action", params.action);
    if (params.targetId) qs.set("targetId", params.targetId);
    if (params.success !== undefined) qs.set("success", String(params.success));
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<{
      result: AdminAuditListResult;
      actions: Array<{ action: string; count: number }>;
    }>(`/admin/audit-logs${suffix}`);
  },

  /** 导出当前筛选结果 (CSV, 上限 5000 行) */
  exportCsv: (
    params: {
      actorId?: string;
      action?: string;
      targetId?: string;
      success?: boolean;
      from?: string;
      to?: string;
    } = {},
  ) => downloadCsv(`/admin/audit-logs/export${toQuery(params)}`),
};

/**
 * 数据备份与保留期。
 *
 * 下载走 blob 而非普通 request(): 响应是二进制, 走 JSON 剥壳逻辑会损坏内容。
 */
export const adminBackupsApi = {
  list: () => request<AdminBackup[]>("/admin/backups"),

  stats: () => request<AdminBackupStats>("/admin/backups/stats"),

  detail: (id: string) => request<AdminBackup>(`/admin/backups/${id}`),

  /**
   * 手动备份。重复点击由调用方的 busy 状态拦截；后端不承诺跨请求幂等。
   */
  run: () => request<AdminBackup>("/admin/backups", { method: "POST" }),

  /** 恢复验证 B-97: 只读打开备份文件做完整性检查, 不触碰生产库 */
  verify: (id: string) =>
    request<AdminBackup>(`/admin/backups/${id}/verify`, { method: "POST" }),

  /** 保留份数清理 */
  prune: (keepCount: number) =>
    request<{ removed: number; freedBytes: number }>("/admin/backups/prune", {
      method: "POST",
      body: { keepCount },
    }),

  remove: (id: string) =>
    request<{ id: string; filename: string }>(`/admin/backups/${id}`, {
      method: "DELETE",
    }),

  /**
   * 下载备份。
   *
   * 单独走 fetch + blob: 后端返回的是二进制流, 走 request() 会被
   * unwrapEnvelope 当 JSON 解析而损坏。仅**已验证**的备份可下载 (B-97)。
   */
  download: async (id: string, filename: string): Promise<void> => {
    const res = await fetch(`${API_ROOT}/admin/backups/${id}/download`, {
      headers: { Authorization: `Bearer ${getToken() ?? ""}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(extractErrorMessage(body, "下载失败"));
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    // 立即 revoke 会让部分浏览器下载中断, 延迟释放
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

/** 素材与项目管理 (B-21~B-27) */
export const adminAssetsApi = {
  list: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<AdminAssetListResult>(`/admin/assets${suffix}`);
  },

  stats: () => request<AdminAssetStats>("/admin/assets/stats"),

  impact: (id: string) =>
    request<{ sizeBytes: number; tasks: number; storageBackend: string }>(
      `/admin/assets/${id}/impact`,
    ),

  /** 下架/恢复。文件与记录都保留, 误操作可恢复 */
  setStatus: (id: string, status: AssetStatus) =>
    request<{ id: string; status: AssetStatus }>(`/admin/assets/${id}/status`, {
      method: "PATCH",
      body: { status },
    }),

  /** 批量下架。每条仍写审计 —— 批量不等于免审计 */
  batchStatus: (ids: string[], status: AssetStatus) =>
    request<{ count: number; status: AssetStatus }>(
      "/admin/assets/batch-status",
      {
        method: "POST",
        body: { ids, status },
      },
    ),

  remove: (id: string) =>
    request<{ id: string; removedTasks: number }>(`/admin/assets/${id}`, {
      method: "DELETE",
    }),

  listProjects: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<AdminProjectListResult>(`/admin/projects${suffix}`);
  },

  removeProject: (id: string, hard = false) =>
    request<{
      id: string;
      hard: boolean;
      impact: { assets: number; tasks: number; bytes: number };
    }>(`/admin/projects/${id}${hard ? "?hard=true" : ""}`, {
      method: "DELETE",
    }),

  /** 批量下架 / 恢复 / 删除。删除不可逆，权限单独校验 (asset.delete) */
  batch: (ids: string[], action: "hide" | "show" | "delete") =>
    request<BatchSummary<unknown>>("/admin/assets/batch", {
      method: "POST",
      body: { ids, action },
    }),

  /** 导出当前筛选结果 (CSV) */
  exportCsv: (params: Record<string, string | number | undefined> = {}) =>
    downloadCsv(`/admin/assets/export${toQuery(params)}`),
};

/** 存储后端管理 (B-62/B-63)。凭据只读, 界面不可编辑 */
export const adminStorageApi = {
  status: () => request<AdminStorageStatus>("/admin/storage/status"),

  probe: (backend?: string) =>
    request<{
      backend: string;
      ok: boolean;
      message: string;
      latencyMs?: number;
    }>(`/admin/storage/probe${backend ? `?backend=${backend}` : ""}`, {
      method: "POST",
    }),

  setActive: (backend: StorageBackendId) =>
    request<{ active: StorageBackendId; note: string }>(
      `/admin/storage/active?backend=${backend}`,
      {
        method: "POST",
      },
    ),
};

/**
 * 营销中心 (admin-prd.md §3.12 B-64~B67 / M11)。
 *
 * 券不提供删除端点 —— 已核销订单仍引用该券, 删了历史订单悬空。
 * 只能通过 toggle 停用。
 */
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
  toggleCoupon: (id: string) =>
    request<AdminCoupon>(`/admin/coupons/${id}/toggle`, { method: "PATCH" }),

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

  /** 导出当前筛选结果 (CSV, 上限 5000 行) */
  exportCampaigns: (
    params: { keyword?: string; type?: string; status?: string } = {},
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

// ────────────────────────────────────────────────────────────────────
// 交易后台 (B1): 商品 / 订单 / 支付流水 / 积分账本 / 保留期清理
// ────────────────────────────────────────────────────────────────────

/**
 * 把对象拼成 query string, 空值一律跳过 (空串会让后端把筛选条件当成"等于空")。
 *
 * 用泛型约束而非 `Record<...>`: 各查询条件以 `interface` 声明, 而 interface 不会
 * 生成隐式索引签名, 收窄成 Record 会把它们全部挡在门外 (见 `AdminApiLogQuery`)。
 */
function toQuery<T extends object>(params: T): string {
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
async function downloadCsv(path: string, filename?: string): Promise<void> {
  const res = await fetch(`${API_ROOT}${path}`, {
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(extractErrorMessage(body, "导出失败"));
  }
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
}

/**
 * 带鉴权打开 HTML 文档 (发票预览 / 打印)。
 *
 * 不能直接用 `<a href>`: 发票文件接口要求 Authorization 头, 浏览器新开
 * 标签页不会带上它, 结果是 401 被当成「链接失效」。故先用 fetch 取回
 * Blob 再打开 blob: URL —— 代价是地址栏看不到真实路径, 换来的是可打印。
 */
async function openHtmlDocument(path: string): Promise<void> {
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

/**
 * 商品管理 (B-34~B-36)。
 *
 * 无删除: 历史订单的明细存了快照, 删商品不会让订单显示不全, 但对账时
 * 就再也查不到"这个 SKU 原来卖多少钱"了 —— 下架即够。
 */
export const adminProductsApi = {
  list: (status?: "active" | "offline") =>
    request<AdminProduct[]>(`/admin/products${toQuery({ status })}`),

  create: (payload: CreateProductPayload) =>
    request<AdminProduct>("/admin/products", { method: "POST", body: payload }),

  /** sku 不可改, 故 payload 里没有该字段 */
  update: (id: string, payload: UpdateProductPayload) =>
    request<AdminProduct>(`/admin/products/${id}`, {
      method: "PATCH",
      body: payload,
    }),

  setStatus: (id: string, status: "active" | "offline") =>
    request<{ id: string; status: string }>(`/admin/products/${id}/status`, {
      method: "PATCH",
      body: { status },
    }),
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
      from?: string;
      to?: string;
    } = {},
  ) => downloadCsv(`/admin/orders/export${toQuery(params)}`),

  /**
   * 手工核销: 线下转账/渠道掉单时由财务确认。
   *
   * 幂等 —— 重复点击返回 idempotentHit=true 而非重复发积分。
   * 交易号用 `MANUAL-<管理员>-<时间戳>` 由后端生成, 不与渠道流水混在一起。
   */
  markPaid: (id: string) =>
    request<{ order: Order; idempotentHit: boolean; message?: string }>(
      `/admin/orders/${id}/mark-paid`,
      { method: "POST" },
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
   * 返回里区分 creditsReclaimed / creditsUnreclaimable —— 积分已被消耗的部分
   * 扣不回来, 界面必须显示出来, 否则财务会以为"退款即已全额回收"。
   */
  refund: (id: string, amountCents: number, reason: string) =>
    request<{
      refundId: string;
      state: "succeeded" | "processing";
      pending: boolean;
      refundedCents: number;
      fullyRefunded: boolean;
      creditsReclaimed: number;
      creditsUnreclaimable: number;
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

  /**
   * 人工调整。`reason` 必填 —— 后端把它写进积分流水，
   * 事后核查「为什么给他加 100」只能靠它。
   */
  adjust: (payload: { userId: string; delta: number; reason: string; validDays?: number }) =>
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
    reason: string;
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

/**
 * 支付域后台 API（`/admin/payments` 四标签页）。
 *
 * 与旧的 `adminPaymentChannelsApi` / `adminReconciliationApi` 是两代模型：
 * 旧版从环境变量读凭据、单一 PAYMENT_PROVIDER、人工导入账单逐笔处置；
 * 新版渠道配置**加密落库并版本化**、多渠道并存、对账由 worker 自动下载并
 * 自动补发。后端旧控制器已删除，故这里只有新契约。
 *
 * 分四组对应四个标签：渠道 / 商品 / 订单 / 对账。
 */

/** 支付渠道与站点设置 */
export const adminPaymentProvidersApi = {
  list: () =>
    request<{ items: AdminPaymentProviderView[] }>("/admin/payments/providers"),

  /**
   * 保存渠道配置（追加新版本，历史订单继续用旧版本）。
   *
   * 高危动作：后端写审计日志，但不要求填写变更原因。
   */
  saveConfig: (providerId: string, body: PaymentProviderConfigUpdate) =>
    request<{ provider: AdminPaymentProviderView; unchanged: boolean }>(
      `/admin/payments/providers/${providerId}/config`,
      { method: "PUT", body },
    ),

  settings: () => request<AdminPaymentSettings>("/admin/payments/settings"),

  saveSettings: (body: { defaultCurrency: PaymentCurrency }) =>
    request<AdminPaymentSettings>("/admin/payments/settings", {
      method: "PUT",
      body,
    }),
};

/** 充值商品 */
export const adminPaymentProductsApi = {
  list: () =>
    request<{ items: AdminPaymentProductView[] }>("/admin/payments/products"),

  create: (body: PaymentProductInput) =>
    request<{ product: AdminPaymentProductView }>("/admin/payments/products", {
      method: "POST",
      body,
    }),

  update: (id: string, body: PaymentProductInput) =>
    request<{ product: AdminPaymentProductView }>(
      `/admin/payments/products/${id}`,
      {
        method: "PUT",
        body,
      },
    ),
};

/** 支付订单 */
export const adminPaymentOrdersApi = {
  list: (
    params: {
      status?: string;
      keyword?: string;
      providerId?: string;
      timeField?: "created" | "paid" | "credited";
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) =>
    request<AdminPageResult<AdminPaymentOrderRow>>(
      `/admin/payments/orders${toQuery(params)}`,
    ),

  detail: (id: string) =>
    request<{ order: AdminPaymentOrderDetail }>(`/admin/payments/orders/${id}`),

  /** 向渠道查单：已支付则立即入账，否则不动本地状态 */
  query: (id: string) =>
    request<{ order: { id: string; status: string }; view: unknown }>(
      `/admin/payments/orders/${id}/query`,
      { method: "POST" },
    ),

  /**
   * 关单。
   *
   * **不会退款**：关单只停止这笔未支付订单继续挂着；已付款的订单要走退款流程，
   * 退款在订单管理里，不在支付域。
   */
  close: (id: string) =>
    request<{ order: { id: string; status: string }; view: unknown }>(
      `/admin/payments/orders/${id}/close`,
      { method: "POST" },
    ),

  exportCsv: (
    params: {
      status?: string;
      keyword?: string;
      providerId?: string;
      timeField?: "created" | "paid" | "credited";
      from?: string;
      to?: string;
    } = {},
  ) => downloadCsv(`/admin/payments/orders/export.csv${toQuery(params)}`),
};

/** 支付对账 */
export const adminPaymentReconciliationApi = {
  /** 运行列表 */
  list: (
    params: {
      providerId?: string;
      status?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) =>
    request<AdminPageResult<AdminReconciliationRun>>(
      `/admin/payments/reconciliations${toQuery(params)}`,
    ),

  /** 差异明细 */
  items: (
    runId: string,
    params: { result?: string; page?: number; pageSize?: number } = {},
  ) =>
    request<AdminPageResult<AdminReconciliationItem>>(
      `/admin/payments/reconciliations/${runId}/items${toQuery(params)}`,
    ),

  /** 手动执行对账（渠道账单下载失败时的重跑入口） */
  run: (body: { providerId: PaymentProviderId; billDate: string }) =>
    request<{ run: AdminReconciliationRun; reused: boolean }>(
      "/admin/payments/reconciliations",
      {
        method: "POST",
        body,
      },
    ),

  /** CSV 兜底导入（渠道不支持账单下载时用） */
  importCsv: (
    file: File,
    body: { providerId: PaymentProviderId; billDate: string },
  ) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("providerId", body.providerId);
    fd.append("billDate", body.billDate);
    return request<{ run: AdminReconciliationRun }>(
      "/admin/payments/reconciliations/import",
      {
        method: "POST",
        body: fd,
      },
    );
  },

  exportCsv: (
    params: {
      providerId?: string;
      status?: string;
      from?: string;
      to?: string;
    } = {},
  ) =>
    downloadCsv(`/admin/payments/reconciliations/export.csv${toQuery(params)}`),

  exportItemsCsv: (runId: string, params: { result?: string } = {}) =>
    downloadCsv(
      `/admin/payments/reconciliations/${runId}/items/export.csv${toQuery(params)}`,
    ),
};

/**
 * 账户自助 (B4)。
 *
 * 路径全部用 `/me`：路由层面就没有「别人的账号」这个概念，
 * 不可能因为漏校验 :id 而越权。
 */
export const meApi = {
  profile: () => request<MyProfile>("/me"),

  update: (data: { name?: string }) =>
    request<{ id: string; email: string; name: string }>("/me", {
      method: "PATCH",
      body: data,
    }),

  /** 改密成功后该账号全部旧 token 失效（含当前这把），调用方必须跳登录 */
  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ changed: true }>("/me/password", {
      method: "POST",
      body: { oldPassword, newPassword },
    }),

  /** 个人数据导出（JSON）。调用方负责用 Blob 下载 */
  exportData: () =>
    request<Record<string, unknown>>("/me/export", { method: "POST" }),

  deletionPreview: () => request<DeletionPreview>("/me/deletion-preview"),

  /** 自助注销：密码 + 确认词「注销」 */
  deleteAccount: (password: string, confirm: string) =>
    request<{ id: string; deleted: boolean }>("/me", {
      method: "DELETE",
      body: { password, confirm },
    }),
};

/**
 * 法务文档（公开，免登录）。
 *
 * `current` 的数据可能为 null（后台从未发布过）—— 前端保留内置兜底文本，
 * 页面不能因为"没种数据"而白屏。
 */
export const legalApi = {
  index: () => request<LegalIndexItem[]>("/legal"),
  current: (slug: string) => request<LegalDoc | null>(`/legal/${slug}`),
};

/** 站内消息 */
export const notificationsApi = {
  list: (params: { unreadOnly?: boolean; limit?: number } = {}) =>
    request<NotificationList>(`/notifications${toQuery(params)}`),

  read: (id: string) =>
    request<{ id: string; read: boolean; unread: number }>(
      `/notifications/${id}/read`,
      { method: "POST" },
    ),

  readAll: () =>
    request<{ updated: number; unread: number }>("/notifications/read-all", {
      method: "POST",
    }),
};

/** 后台：法务文档版本管理 */
export const adminLegalApi = {
  versions: (slug?: string) =>
    request<AdminLegalDoc[]>(
      `/admin/legal${slug ? `?slug=${encodeURIComponent(slug)}` : ""}`,
    ),

  upsert: (data: {
    slug: string;
    version: string;
    title: string;
    content: string;
    status?: "draft" | "published" | "archived";
  }) => request<AdminLegalDoc>("/admin/legal", { method: "PUT", body: data }),

  publish: (slug: string, version: string) =>
    request<AdminLegalDoc>(
      `/admin/legal/${encodeURIComponent(slug)}/${encodeURIComponent(version)}/publish`,
      { method: "POST" },
    ),
};

/** 后台：站内消息广播与模板 */
export const adminNotificationsApi = {
  broadcast: (data: { title: string; body: string; link?: string }) =>
    request<{ sent: number; users: number }>("/admin/notifications/broadcast", {
      method: "POST",
      body: data,
    }),

  templates: () =>
    request<MessageTemplateItem[]>("/admin/notifications/templates"),

  /** 邮件 / 短信通道实际生效的实现（console = 不真实投递） */
  channels: () =>
    request<DeliveryChannelStatusMap>("/admin/notifications/channels"),

  upsertTemplate: (data: {
    code: string;
    channel: "inapp" | "email" | "sms";
    subject?: string;
    body: string;
    enabled?: boolean;
  }) =>
    request<MessageTemplateItem>("/admin/notifications/templates", {
      method: "POST",
      body: data,
    }),
};

// ────────────────────────────────────────────────────────────────────
// 工单 / 反馈 + 全局搜索 (B7)
// ────────────────────────────────────────────────────────────────────

/**
 * C 端工单。
 *
 * 只暴露「我的」视角：越权访问后端一律 404（而非 403），
 * 前端不必区分「不存在」和「不是你的」。
 */
export const ticketsApi = {
  list: (params: { status?: string; limit?: number; offset?: number } = {}) =>
    request<TicketListResult>(`/tickets${toQuery(params)}`),

  create: (payload: CreateTicketPayload) =>
    request<Ticket>("/tickets", { method: "POST", body: payload }),

  detail: (id: string) => request<Ticket>(`/tickets/${id}`),

  /** 用户回复。resolved 会回落到 open；closed 后端拒绝 */
  reply: (id: string, content: string) =>
    request<Ticket>(`/tickets/${id}/replies`, {
      method: "POST",
      body: { content },
    }),

  close: (id: string) =>
    request<Ticket>(`/tickets/${id}/close`, { method: "POST" }),
};

/** 后台工单处理中心 */
export const adminTicketsApi = {
  stats: () => request<TicketStats>("/admin/tickets/stats"),

  list: (
    params: {
      status?: string;
      type?: string;
      priority?: string;
      assigneeId?: string;
      q?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) => request<AdminTicketListResult>(`/admin/tickets${toQuery(params)}`),

  detail: (id: string) => request<AdminTicketDetail>(`/admin/tickets/${id}`),

  reply: (id: string, content: string) =>
    request<AdminTicketDetail>(`/admin/tickets/${id}/replies`, {
      method: "POST",
      body: { content },
    }),

  /**
   * 流转 / 指派 / 改优先级。
   *
   * `assigneeId: null` = 取消指派（显式传 null 与"不传"语义不同，
   * 后端靠 this distinction 区分；这里用 `in` 判断保留它）。
   */
  update: (
    id: string,
    payload: {
      status?: string;
      priority?: string;
      assigneeId?: string | null;
    },
  ) =>
    request<AdminTicketDetail>(`/admin/tickets/${id}`, {
      method: "PATCH",
      body: payload,
    }),

  exportCsv: (
    params: {
      status?: string;
      type?: string;
      priority?: string;
      assigneeId?: string;
      q?: string;
    } = {},
  ) => downloadCsv(`/admin/tickets/export${toQuery(params)}`),
};

/**
 * 后台全局搜索。
 *
 * 每类只回前 5 条 + 该类总数：顶栏搜索的用途是「跳过去」，
 * 不是「在搜索结果里继续翻页」。单字符（<2）返回空组而不是报错。
 */
export const adminSearchApi = {
  search: (q: string, signal?: AbortSignal) =>
    request<AdminSearchResult>(`/admin/search${toQuery({ q })}`, { signal }),
};

/* ══════════════════════ 渠道与模型域（`src/model/**`） ══════════════════════ */

/**
 * 后台渠道（`/admin/channels`）。
 *
 * open-ai-canvas 移植后的渠道工作台：一条渠道可以挂任意模态的模型，
 * 模型是线路的最小单位（各自启停、各自冷却）。
 */
export const adminChannelsApi = {
  list: (
    params: {
      keyword?: string;
      status?: string;
      page?: number;
      limit?: number;
    } = {},
  ) => request<ChannelPageResult>(`/admin/channels${toQuery(params)}`),

  order: () =>
    request<{ items: ChannelOrderItemView[] }>("/admin/channels/order"),

  /** 线路健康（一行 = 一条渠道模型，含进程内冷却快照） */
  health: () =>
    request<{ items: ChannelHealthRowView[] }>("/admin/channels/health"),

  /** 可选协议目录；`capability` 用于按模态过滤（图像 / 文本 / 视频 / 音频） */
  protocols: (capability?: string) =>
    request<{ protocols: ProtocolCatalogEntryView[] }>(
      `/admin/channels/protocols${toQuery({ capability })}`,
    ),

  /** 整表排序：`expectedIds` 是并发保护，与后台当前顺序不一致时整单拒绝 */
  saveOrder: (ids: string[], expectedIds: string[]) =>
    request<{ ok: boolean }>("/admin/channels/order", {
      method: "PUT",
      body: { ids, expectedIds },
    }),

  exportAll: (ids?: string[]) =>
    request<SystemChannelExportView>("/admin/channels/export", {
      method: "POST",
      body: ids && ids.length > 0 ? { ids } : {},
    }),

  importAll: (payload: SystemChannelExportView) =>
    request<SystemChannelImportResultView>("/admin/channels/import", {
      method: "POST",
      body: payload,
    }),

  get: (id: string) => request<AdminChannelView>(`/admin/channels/${id}`),

  create: (body: Record<string, unknown>) =>
    request<AdminChannelView>("/admin/channels", { method: "POST", body }),

  update: (id: string, body: Record<string, unknown>) =>
    request<AdminChannelView>(`/admin/channels/${id}`, {
      method: "PATCH",
      body,
    }),

  /**
   * 删除渠道（软删除）。
   *
   * 删除是业务操作，保留前端确认；审计由后端按操作人、动作和结果记录。
   * 渠道模型删除同样不要求填写原因。
   */
  remove: (id: string) =>
    request<{ ok: boolean }>(`/admin/channels/${id}`, { method: "DELETE" }),

  duplicate: (id: string) =>
    request<AdminChannelView>(`/admin/channels/${id}/duplicate`, {
      method: "POST",
    }),

  models: (id: string) =>
    request<{ models: AdminChannelModelView[] }>(
      `/admin/channels/${id}/models`,
    ),

  modelOrder: (id: string) =>
    request<{ items: ChannelOrderItemView[] }>(
      `/admin/channels/${id}/models/order`,
    ),

  saveModelOrder: (id: string, ids: string[], expectedIds: string[]) =>
    request<{ ok: boolean }>(`/admin/channels/${id}/models/order`, {
      method: "PUT",
      body: { ids, expectedIds },
    }),

  createModel: (id: string, body: Record<string, unknown>) =>
    request<AdminChannelModelView>(`/admin/channels/${id}/models`, {
      method: "POST",
      body,
    }),

  updateModel: (id: string, modelId: string, body: Record<string, unknown>) =>
    request<AdminChannelModelView>(`/admin/channels/${id}/models/${modelId}`, {
      method: "PATCH",
      body,
    }),

  /**
   * 删除单条渠道模型（软删除）。
   *
   * 删除保留业务确认；审计记录操作人、动作与结果，不要求填写原因。
   */
  removeModel: (id: string, modelId: string) =>
    request<{ deleted: number }>(`/admin/channels/${id}/models/${modelId}`, {
      method: "DELETE",
    }),

  /**
   * 批量删除渠道模型（全有或全无）。
   *
   * 删除保留业务确认；审计记录操作人、动作与结果，不要求填写原因。
   */
  batchDeleteModels: (id: string, ids: string[]) =>
    request<{ deleted: number }>(`/admin/channels/${id}/models/batch-delete`, {
      method: "POST",
      body: { ids },
    }),

  /** 批量调价：提交最终售价，价格版本过期时后端整批拒绝 */
  batchRepriceModels: (id: string, models: ChannelModelRepriceInput[]) =>
    request<{ updated: number }>(`/admin/channels/${id}/models/batch-reprice`, {
      method: "POST",
      body: { models },
    }),

  /** 读取上游模型目录（只读）：用已保存凭证在服务端拉取，密钥不经过浏览器 */
  fetchModels: (id: string) =>
    request<{ models: UpstreamModelPreview[] }>(
      `/admin/channels/${id}/models/fetch`,
      {
        method: "POST",
      },
    ),

  importModels: (id: string, models: string[]) =>
    request<ChannelModelFetchResultView>(
      `/admin/channels/${id}/models/import`,
      {
        method: "POST",
        body: { models },
      },
    ),

  testModel: (id: string, body: Record<string, unknown>) =>
    request<ProtocolTestResultView>(`/admin/channels/${id}/models/test`, {
      method: "POST",
      body,
    }),

  setModelEnabled: (id: string, modelId: string, enabled: boolean) =>
    request<{ ok: boolean }>(
      `/admin/channels/${id}/models/${modelId}/enabled`,
      {
        method: "PATCH",
        body: { enabled },
      },
    ),

  setModelSort: (id: string, modelId: string, sortOrder: number) =>
    request<{ ok: boolean }>(`/admin/channels/${id}/models/${modelId}/sort`, {
      method: "PATCH",
      body: { sortOrder },
    }),
};

/** 跨渠道的模型只读视图（选路下拉与全局排查用） */
export const adminChannelModelsApi = {
  /**
   * 跨渠道模型列表。
   *
   * `includeDisabled` 为真时含已停用的模型（后台「全部模型」视图用）；
   * 默认只给启用的模型（前台模型的线路选择器用 —— 停用线路进了下拉会
   * 让人以为「选了就能用」）。
   */
  list: (channelId?: string, includeDisabled = false) =>
    request<{ models: AdminChannelModelListItem[] }>(
      `/admin/channel-models${toQuery({ channelId, includeDisabled: includeDisabled ? "1" : undefined })}`,
    ),

  /** 线路健康指标（24h / 7d 成功率、P95、最近样本） */
  health: (channelId?: string) =>
    request<{ items: ChannelModelHealthRowView[] }>(
      `/admin/channel-models/health${toQuery({ channelId })}`,
    ),
};

/** 后台前台模型（`/admin/logical-models`）：保存即写新 revision 并重建线路 */
export const adminLogicalModelsApi = {
  list: (includeArchived = false) =>
    request<AdminLogicalModelView[]>(
      `/admin/logical-models${toQuery({ includeArchived: includeArchived ? "1" : undefined })}`,
    ),

  get: (id: string) =>
    request<AdminLogicalModelView>(`/admin/logical-models/${id}`),

  create: (body: Record<string, unknown>) =>
    request<AdminLogicalModelView>("/admin/logical-models", {
      method: "POST",
      body,
    }),

  update: (id: string, body: Record<string, unknown>) =>
    request<AdminLogicalModelView>(`/admin/logical-models/${id}`, {
      method: "PATCH",
      body,
    }),

  archive: (id: string) =>
    request<{ ok: boolean }>(`/admin/logical-models/${id}`, {
      method: "DELETE",
    }),

  /** 路由模拟（只读）：回答「这组参数会落到哪条线路、为什么没落」 */
  simulate: (id: string, body: ModelIntentPayload) =>
    request<SimulateResultView>(`/admin/logical-models/${id}/simulate`, {
      method: "POST",
      body,
    }),
};

/** 用户分组：倍率、渠道可见范围与按模型的价格覆盖 */
export const adminUserGroupsApi = {
  list: () => request<UserGroupView[]>("/admin/user-groups"),

  get: (id: string) => request<UserGroupView>(`/admin/user-groups/${id}`),

  create: (body: Record<string, unknown>) =>
    request<UserGroupView>("/admin/user-groups", { method: "POST", body }),

  update: (id: string, body: Record<string, unknown>) =>
    request<UserGroupView>(`/admin/user-groups/${id}`, {
      method: "PATCH",
      body,
    }),

  remove: (id: string) =>
    request<{ ok: boolean }>(`/admin/user-groups/${id}`, { method: "DELETE" }),
};

/** 内置插件：启停立即重注册协议；校验只查契约不发上游请求 */
export const adminPluginsApi = {
  list: () => request<PluginListResult>("/admin/plugins"),

  get: (id: string) => request<PluginView>(`/admin/plugins/${id}`),

  setEnabled: (id: string, enabled: boolean) =>
    request<PluginView>(`/admin/plugins/${id}`, {
      method: "PATCH",
      body: { enabled },
    }),

  /** 契约校验只返回校验结果（不返回插件视图），页面据此提示通过/失败 */
  verify: (id: string) =>
    request<PluginVerifyResultView>(`/admin/plugins/${id}/verify`, {
      method: "POST",
    }),

  /**
   * 上传安装插件包（zip）。
   *
   * 走 multipart 而不是 base64 JSON：插件包上限 48MB，base64 会再多三分之一，
   * 且需求本来就是一个文件选择框。
   */
  install: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<PluginView>("/admin/plugins/install", {
      method: "POST",
      body: form,
    });
  },

  uninstall: (id: string) =>
    request<{ id: string; removed: boolean }>(`/admin/plugins/${id}`, {
      method: "DELETE",
    }),
};

/** 服务商目录：远端清单 + 一键安装对应厂商插件 */
export const adminProviderCatalogApi = {
  list: () => request<ProviderCatalogView>("/admin/provider-catalog"),

  refresh: () =>
    request<ProviderCatalogView>("/admin/provider-catalog/refresh", {
      method: "POST",
    }),

  verify: (id: string) =>
    request<ProviderVerifyResult>(`/admin/provider-catalog/${id}/verify`, {
      method: "POST",
    }),

  install: (id: string) =>
    request<PluginView>(`/admin/provider-catalog/${id}/install`, {
      method: "POST",
      body: {},
    }),
};

/** 生成账单：只读列表 + 人工核对（`settle` / `refund`，原因必填） */
export const adminBillingOrdersApi = {
  list: (
    params: {
      status?: string;
      userId?: string;
      taskId?: string;
      model?: string;
      channelId?: string;
      billingMode?: string;
      group?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) =>
    request<BillingOrderListResult>(`/admin/billing-orders${toQuery(params)}`),

  get: (id: string) => request<BillingOrderView>(`/admin/billing-orders/${id}`),

  resolve: (id: string, action: "settle" | "refund", reason: string) =>
    request<BillingOrderView>(`/admin/billing-orders/${id}/resolve`, {
      method: "POST",
      body: { action, reason },
    }),

  /** 批量核对：逐条独立处置，返回每条结果 */
  batchResolve: (ids: string[], action: "settle" | "refund", reason: string) =>
    request<BillingBatchResolveResult>(`/admin/billing-orders/batch-resolve`, {
      method: "POST",
      body: { ids: ids.join(","), action, reason },
    }),
};

/** 调用记录的筛选条件：列表与导出共用（导出忽略分页） */
export interface AdminApiLogQuery {
  status?: string;
  requestKind?: string;
  channelId?: string;
  taskId?: string;
  userId?: string;
  model?: string;
  billable?: string;
  from?: string;
  to?: string;
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

/** 前台模型目录（产品视角，`/models*`） */
export const modelsApi = {
  list: () => request<{ models: PublicLogicalModel[] }>("/models"),

  available: (intent: ModelIntentPayload) =>
    request<{ models: PublicLogicalModel[] }>("/models/available", {
      method: "POST",
      body: intent,
    }),

  quote: (id: string, intent: ModelIntentPayload) =>
    request<{ quote: ModelQuoteView }>(`/models/${id}/quote`, {
      method: "POST",
      body: intent,
    }),
};

/**
 * 渠道模型目录（供应视角，`/model-catalog*`）。
 *
 * `models` 恒为空数组，模型在 `channels[].models` 内；渠道名恒为空串，
 * 前端统一显示「系统模型」。报价必须带 `channelId` + `modelKey` ——
 * 不同渠道的同名模型价格与协议都可能不同，不接受按 modelKey 全局搜索。
 */
export const modelCatalogApi = {
  catalog: () => request<PublicModelCatalogResult>("/model-catalog"),

  available: (intent: ModelIntentPayload) =>
    request<PublicModelCatalogResult>("/model-catalog/available", {
      method: "POST",
      body: intent,
    }),

  quote: (channelId: string, modelKey: string, intent: ModelIntentPayload) =>
    request<{ quote: ModelQuoteView }>("/model-catalog/quote", {
      method: "POST",
      body: { ...intent, channelId, modelKey },
    }),
};

/**
 * 公开的系统渠道连接信息（`/channels/system`）。
 *
 * 与 `/model-catalog` 的分工：目录给「有哪些模型、什么价」，本端点给
 * 「有哪些渠道、怎么连（中转入口）」。两者都不下发凭证与上游地址。
 *
 * 管理员走同一端点拿到后台视角（真实名称与上游地址），因此返回类型用
 * `PublicChannelView` 的宽松基线：非管理员视角下 `name` 恒为空串。
 */
export const publicChannelsApi = {
  system: () => request<{ channels: PublicChannelView[] }>("/channels/system"),
};
