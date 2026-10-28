import { API_BASE } from './constants';
import { API_ROOT, extractErrorMessage, unwrapEnvelope } from './http';
import { clearStoredEmail, clearToken, getToken } from './auth';
import type {
  AdminAuditListResult,
  AdminBackup,
  AdminBackupStats,
  AdminCleanupLog,
  AdminMe,
  AdminModelCall,
  AdminModelCallListResult,
  AdminModelConfig,
  AdminModelConfigTestAllResult,
  AdminModelConfigTestResult,
  AdminModelChannelRecord,
  AdminModelChannelsSnapshot,
  AdminModelListResult,
  AdminChannelTestResult,
  AdminChannelTestAllResult,
  AdminVendorFillPlan,
  Modality,
  AdminOverview,
  AdminPasswordReset,
  AdminPermissionCatalog,
  AdminRoleItem,
  AdminSettings,
  AdminSettingField,
  AdminAigcLabel,
  AigcLabelSpec,
  AdminUserDetail,
  AdminUserImpact,
  AdminLoginLogResult,
  AdminUserListResult,
  AdminAssetListResult,
  AdminAssetStats,
  AdminProjectListResult,
  AdminStorageStatus,
  AdminPaymentChannelStatus,
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
  AdminOrderListResult,
  AdminOrderDetail,
  AdminPaymentRow,
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
  Product,
  ProductsResponse,
  Order,
  CreditBalance,
  CreditLot,
  CreditLedgerEntry,
  SandboxPayResult,
  PaymentIntent,
  PaymentStatusResult,
  Invoice,
  InvoiceStatus,
  CreateInvoicePayload,
  AdminInvoice,
  ReconciliationBatch,
  ReconciliationBatchDetail,
  ReconciliationItem,
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
} from '../types/api';

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
    this.name = 'ApiError';
  }
}

const BASE = API_ROOT;

interface RequestOptions {
  method?: string;
  headers?: HeadersInit;
  signal?: AbortSignal | null;
  // 具体 DTO 类型 (LoginRequest 等) 没有索引签名, 不能直接赋值给 Record<string, unknown>,
  // 故用 unknown 收口后在运行时 JSON.stringify。
  body?: BodyInit | Record<string, unknown> | object | null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let body: BodyInit | null | undefined;
  if (options.body && options.body instanceof FormData) {
    body = options.body;
  } else if (options.body) {
    headers.set('Content-Type', 'application/json');
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
    if (res.status === 401 && path !== '/auth/login') {
      if (getToken()) {
        clearToken();
        clearStoredEmail();
        window.dispatchEvent(new Event('auth:unauthorized'));
      } else if ((options.method ?? 'GET').toUpperCase() !== 'GET') {
        /*
         * 只有**用户主动触发的写动作** (提交生成 / 上传 / 建项目) 才弹登录框。
         *
         * 页面加载的读请求 401 不弹: 路由已对外开放, 各页自己渲染未登录空态。
         * 若读请求也弹, guest 一进 /workbench 就被 `stats/overview` 的 401
         * 自动糊一脸登录墙 (实测 /credits 会连弹三组), 与
         * 「guest 不被动弹登录」的契约直接冲突。
         */
        window.dispatchEvent(new Event('auth:required'));
      }
    }
    let message = `请求失败（${res.status}）`;
    let requestId: string | null = res.headers.get('X-Request-Id');
    let bodyCode: unknown;
    try {
      const body = (await res.json()) as Record<string, unknown>;
      bodyCode = body.code;
      message = extractErrorMessage(body, message);
      if (typeof body.requestId === 'string') requestId = body.requestId;
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
      window.dispatchEvent(new Event('auth:unauthorized'));
    }
    /*
     * 兜底的「请先登录」只适用于**会话缺失的被动 401**。
     *
     * 登录 / 注册接口的 401 是「凭证错误」（后端 40101 邮箱或密码错误），
     * 之前这里无条件覆盖，导致用户在登录页把密码打错，看到的是
     * 「请先登录」—— 用户本来就以为自己在登录，这个提示自相矛盾，
     * 多数人会以为页面卡住而不是密码错。鉴权入口的 401 原样透出后端文案。
     */
    const isAuthEntry = path.startsWith('/auth/');
    if (res.status === 401 && !getToken() && !isAuthEntry) message = '请先登录';
    /*
     * 5xx 才把请求号拼进文案: 这类错误用户无法自行解决, 报障时必须带上
     * 可检索的 id; 4xx 是用户输入问题, 屏幕上糊一串 uuid 只会干扰。
     * 限流 (429) 单独透出等待秒数, 前端可做倒计时。
     */
    if (res.status >= 500 && requestId) message = `${message}（请求号 ${requestId}）`;
    const retryAfter = Number(res.headers.get('Retry-After') ?? '');
    throw new ApiError(message, res.status, {
      requestId,
      retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
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
    request<AuthResponse>('/auth/login', { method: 'POST', body: data }),
  register: (data: RegisterRequest) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: data }),

  /**
   * 申请密码重置邮件。
   *
   * 后端**恒返回成功**（防账号枚举），前端文案必须是
   * 「如果该邮箱已注册，重置链接已发送」—— 不能承诺「已发送」。
   */
  forgotPassword: (email: string) =>
    request<{ requested: true }>('/auth/password/forgot', { method: 'POST', body: { email } }),

  /** 用邮件里的一次性令牌重置密码；成功后旧会话全部失效 */
  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>('/auth/password/reset', {
      method: 'POST',
      body: { token, password },
    }),

  /** 发送短信验证码。`delivered=false` 表示走了控制台通道（未真实投递） */
  sendSms: (phone: string, purpose: SmsPurpose) =>
    request<{ sent: true; delivered: boolean }>('/auth/sms/send', {
      method: 'POST',
      body: { phone, purpose },
    }),

  smsLogin: (data: SmsLoginRequest) =>
    request<AuthResponse>('/auth/sms/login', { method: 'POST', body: data }),

  /*
   * 扫码登录（B8）。四步：
   *   create  桌面建码，拿到票据（只此一次，不落库明文）
   *   status  桌面轮询；状态 confirmed 的那一次响应里带 accessToken
   *   scan    手机（已登录）扫码，只标记已扫描
   *   confirm 手机确认，唯一真正绑定账号的一步
   */

  qrCreate: () => request<QrCreateResult>('/auth/qr/create', { method: 'POST' }),

  qrStatus: (ticket: string) =>
    request<QrStatusResult>(`/auth/qr/status?ticket=${encodeURIComponent(ticket)}`),

  qrScan: (ticket: string) =>
    request<QrStatusResult>('/auth/qr/scan', { method: 'POST', body: { ticket } }),

  qrConfirm: (ticket: string, approve: boolean) =>
    request<QrStatusResult>('/auth/qr/confirm', { method: 'POST', body: { ticket, approve } }),

  /** 通用 OAuth：列出已启用的 provider，登录页据此渲染按钮 */
  oauthProviders: () => request<OAuthProviderInfo[]>('/auth/oauth/providers'),

  /** OAuth 回调拿到短时 ticket 后换取正式会话 */
  oauthComplete: (ticket: string) =>
    request<AuthResponse>('/auth/oauth/complete', { method: 'POST', body: { ticket } }),
};

/** OAuth 授权跳转地址。浏览器直接导航，不经过 fetch */
export function oauthAuthorizeUrl(providerId: string, returnTo?: string): string {
  const params = new URLSearchParams();
  if (returnTo) params.set('returnTo', returnTo);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return `${API_ROOT}/auth/oauth/${encodeURIComponent(providerId)}/authorize${suffix}`;
}

export const projectsApi = {
  list: () => request<TaskListResult>('/projects').then((r) => asList<Project>(r)),
  create: (name: string) =>
    request<Project>('/projects', { method: 'POST', body: { name } }),
};

export const assetsApi = {
  // projectId 必传: 后端 assets.service.ts:21 校验缺失即 400
  upload: (file: File, projectId: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('projectId', projectId);
    return request<AssetUploadResponse>('/assets/upload', { method: 'POST', body: fd });
  },

  /** 读取单个素材。历史提交恢复需要用它找回当时使用的模板与参考图。 */
  get: (id: string) => request<Asset>(`/assets/${id}`),

  /** 素材库列表: kind=original|generated, capability 过滤, 分页 */
  list: (params: {
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
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.kind) qs.set('kind', params.kind);
    if (params.capability) qs.set('capability', params.capability);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    if (params.keyword) qs.set('keyword', params.keyword);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<AssetListResult>(`/assets${suffix}`);
  },

  /** 删除素材 (生成图会连带删除产出它的任务) */
  remove: (id: string) => request<{ id: string; removedTasks: number }>(`/assets/${id}`, { method: 'DELETE' }),
};

export const generateApi = {
  start: (data: GenerateRequest) => {
    const idempotencyKey = data.idempotencyKey || newIdempotencyKey();
    return request<GenerateResponse>('/generate', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: { ...data, idempotencyKey },
    });
  },
  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  list: () => request<TaskListResult>('/tasks').then((r) => asList<Task>(r)),
  remove: (id: string) => request<{ id: string; removedAsset: boolean }>(`/tasks/${id}`, { method: 'DELETE' }),
};

/** 浏览器端幂等键；不支持 randomUUID 的旧内核仍生成足够随机的回退值。 */
export function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  const random = () => Math.random().toString(36).slice(2, 12);
  return `gen-${Date.now().toString(36)}-${random()}-${random()}`;
}

export const statsApi = {
  overview: () => request<StatsOverview>('/stats/overview'),
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
    request<PromptToolResult>('/prompt-tools/polish', {
      method: 'POST',
      body: { text, textOnly },
    }),

  /** 图片转提示词。传站内素材 id, 不传图片本体 */
  imageToPrompt: (assetId: string, extra?: string) =>
    request<PromptToolResult>('/prompt-tools/image-to-prompt', {
      method: 'POST',
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
    request<MobileUploadSessionCreated>('/mobile-upload/sessions', {
      method: 'POST',
      body: { projectId },
    }),

  /** 电脑端: 轮询会话状态 */
  status: (sessionId: string) =>
    request<MobileUploadSessionStatus>(`/mobile-upload/sessions/${encodeURIComponent(sessionId)}`),

  /** 电脑端: 取消会话 */
  cancel: (sessionId: string) =>
    request<{ ok: boolean }>(`/mobile-upload/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    }),

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
    for (const f of files) fd.append('file', f);
    fd.append('token', token);
    return request<{
      ok: boolean;
      status: string;
      assetId: string | null;
      assets: Array<{ id: string; url: string; filename: string }>;
    }>(`/mobile-upload/sessions/${encodeURIComponent(sessionId)}/receive`, {
      method: 'POST',
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
  list: () => request<ProductsResponse>('/products'),
  detail: (sku: string) => request<Product>(`/products/${encodeURIComponent(sku)}`),
};

/**
 * 积分账户 (需登录)。
 *
 * 余额由后端按批次汇总推导 —— 前端不做任何加减, 也不本地缓存余额,
 * 否则会出现"顶导显示 100, 实际已扣光"这类不一致。
 */
export const creditsApi = {
  balance: () => request<CreditBalance>('/credits/balance'),
  lots: () => request<CreditLot[]>('/credits/lots'),
  ledger: (limit = 50) => request<CreditLedgerEntry[]>(`/credits/ledger?limit=${limit}`),
};

/**
 * 能力消耗价 (后台)。
 *
 * 与 C 端 `/capabilities` 下发的 creditCost 是**同一份数据** ——
 * 后台改价后前者立刻变化, 后者只是把变化传播给前端展示。
 * 两处独立维护必然出现「后台改了、用户看到的没改」。
 */
export const adminCreditPricesApi = {
  list: () => request<AdminCreditPrice[]>('/admin/credit-prices'),
  update: (items: Array<{ capabilityId: string; cost: number }>) =>
    request<{ updated: Array<{ capabilityId: string; cost: number }> }>('/admin/credit-prices', {
      method: 'PUT',
      body: { items },
    }),
  /** 回落代码默认值 */
  reset: (capabilityId: string) =>
    request<{ capabilityId: string; cost: number }>(
      `/admin/credit-prices/${encodeURIComponent(capabilityId)}/reset`,
      { method: 'POST' },
    ),
};

/**
 * 能力上下线（后台「能力管控」）。
 *
 * 下架必须填原因 —— 原因会展示给 C 端用户并进审计。只写「已下线」
 * 会让用户去问客服，写清「云端通道维护中」才是可自助的。
 */
export const adminCapabilitiesApi = {
  list: () => request<AdminCapabilityControl[]>('/admin/capabilities'),

  set: (capabilityId: string, enabled: boolean, reason?: string) =>
    request<{ capabilityId: string; enabled: boolean; reason: string | null }>(
      `/admin/capabilities/${encodeURIComponent(capabilityId)}`,
      { method: 'PUT', body: { enabled, reason } },
    ),
};

/**
 * 会员订阅。
 *
 * `plans` **公开免登录** —— 未登录也要能看到订阅价目才能决定买不买。
 * 其余需登录。
 */
export const membershipApi = {
  plans: () => request<MembershipPlan[]>('/membership/plans'),
  me: () => request<MyMembership>('/membership/me'),
  cancel: () => request<{ expiresAt: string }>('/membership/cancel', { method: 'POST' }),
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
    request<Order>('/orders', {
      method: 'POST',
      body: {
        ...(params.productId ? { productId: params.productId, quantity: params.quantity ?? 1 } : {}),
        ...(params.membershipPlanId ? { membershipPlanId: params.membershipPlanId } : {}),
        idempotencyKey: params.idempotencyKey,
        ...(params.couponCode ? { couponCode: params.couponCode } : {}),
      },
    }),
  list: () => request<Order[]>('/orders'),
  detail: (id: string) => request<Order>(`/orders/${id}`),

  /** 关闭未支付订单。已支付订单只能走退款，后端会拒绝 */
  cancel: (id: string) => request<Order>(`/orders/${id}/cancel`, { method: 'POST' }),

  /**
   * 沙箱支付。
   *
   * ⚠ 沙箱**不产生真实资金流转**, 仅用于开发联调。真实通道接入后此端点废弃。
   * 页面必须显式标注沙箱身份, 不做假支付 UI 蒙混 (commerce-design.md §6.2)。
   */
  sandboxPay: (id: string, scenario: 'success' | 'failed' | 'timeout') =>
    request<SandboxPayResult>(`/orders/${id}/pay`, { method: 'POST', body: { scenario } }),
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
  intent: (orderId: string) =>
    request<PaymentIntent>(`/payments/${orderId}/intent`, { method: 'POST' }),

  status: (orderId: string) => request<PaymentStatusResult>(`/payments/${orderId}/status`),
};

/** 发票 (需登录)。一单一票, 开具后可在后台下载可打印 HTML */
export const invoicesApi = {
  create: (payload: CreateInvoicePayload) =>
    request<Invoice>('/invoices', { method: 'POST', body: payload }),

  list: () => request<{ items: Invoice[]; total: number }>('/invoices'),

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
  me: () => request<AdminMe>('/admin/me'),

  /** 权限点全集与内置角色默认配置 */
  permissions: () => request<AdminPermissionCatalog>('/admin/permissions'),

  /** 平台概览。days 建议只用 7 / 30 / 90, 其它值后端回落到 7 */
  overview: (days: number) => request<AdminOverview>(`/admin/overview?days=${days}`),
};

export function toAbsoluteUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
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
 * 用户与账户管理。
 * 高危动作 (禁用/角色/重置密码/删除) 均对应独立权限点, 便于单独回收。
 */
export const adminUsersApi = {
  list: (params: {
    keyword?: string;
    role?: string;
    status?: string;
    page?: number;
    pageSize?: number;
    sort?: string;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.keyword) qs.set('keyword', params.keyword);
    if (params.role) qs.set('role', params.role);
    if (params.status) qs.set('status', params.status);
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params.sort) qs.set('sort', params.sort);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<AdminUserListResult>(`/admin/users${suffix}`);
  },

  detail: (id: string) => request<AdminUserDetail>(`/admin/users/${id}`),
  /** 最近登录记录。权限 audit.read —— 无权限时 403，前端按「不可见」处理 */
  logins: (id: string, limit = 50) =>
    request<AdminLoginLogResult>(`/admin/users/${id}/logins?limit=${limit}`),

  /** 删除前的连带影响预览, 供确认弹窗展示具体数量 */
  impact: (id: string) => request<AdminUserImpact>(`/admin/users/${id}/impact`),

  changeStatus: (id: string, status: 'active' | 'disabled', reason?: string) =>
    request<{ id: string; status: string }>(`/admin/users/${id}/status`, {
      method: 'PATCH',
      body: { status, reason },
    }),

  changeRole: (id: string, role: string, reason?: string) =>
    request<{ id: string; role: string; roleLabel: string }>(`/admin/users/${id}/role`, {
      method: 'PATCH',
      body: { role, reason },
    }),

  /** 返回一次性临时密码明文 —— 关闭后不可再次查看 */
  resetPassword: (id: string) =>
    request<AdminPasswordReset>(`/admin/users/${id}/password`, { method: 'POST' }),

  /** 默认软删; hard=true 物理删除可删部分 (订单不在删除范围) */
  remove: (id: string, hard = false, confirm?: string) =>
    request<{ id: string; hard: boolean }>(`/admin/users/${id}${hard ? '?hard=true' : ''}`, {
      method: 'DELETE',
      body: { confirm },
    }),

  /** 导出当前筛选结果 (CSV, 上限 5000 行) */
  exportCsv: (params: {
    keyword?: string;
    role?: string;
    status?: string;
    from?: string;
    to?: string;
  } = {}) => downloadCsv(`/admin/users/export${toQuery(params)}`),

  /** 批量启用/禁用。逐条结果 —— 一条失败不影响其余 */
  batch: (ids: string[], action: 'disable' | 'enable', reason?: string) =>
    request<BatchSummary<{ id: string; status: string }>>('/admin/users/batch', {
      method: 'POST',
      body: { ids, action, ...(reason ? { reason } : {}) },
    }),
};

/** 角色权限 */
export const adminRolesApi = {
  list: () => request<{ items: AdminRoleItem[] }>('/admin/roles'),

  updatePermissions: (code: string, permissions: string[], reason?: string) =>
    request<{ code: string; permissions: string[] }>(`/admin/roles/${code}/permissions`, {
      method: 'PATCH',
      body: { permissions, reason },
    }),
};

/** 系统设置 (扁平结构提交, 字段名见后端 FIELD_TO_SETTING_KEY) */
export const adminSettingsApi = {
  read: () => request<AdminSettings>('/admin/settings'),
  update: (payload: Partial<Record<AdminSettingField, string | number | boolean>> & { reason?: string }) =>
    request<{ updated: string[] }>('/admin/settings', { method: 'PATCH', body: payload }),
};

/**
 * AIGC 可见角标样式。
 *
 * `badgePngBase64` 由后台页面用 Canvas 按 spec 渲染，服务端只负责合成。
 * 两者一起提交的原因见后端 `AigcLabelService.save`：分两次写会出现
 * 「文案已改、图上还是旧字」的中间态。
 */
export const adminAigcLabelApi = {
  read: () => request<AdminAigcLabel>('/admin/aigc-label'),
  update: (payload: {
    spec: AigcLabelSpec;
    badgePngBase64: string;
    reason: string;
  }) => request<AdminAigcLabel>('/admin/aigc-label', { method: 'PUT', body: payload }),
};

/**
 * 模型配置与调用记录。
 *
 * 凭据类字段 (gateway.token) 的写入语义特殊: **留空 = 保持原值**,
 * 不是清空 —— 页面回读时拿不到明文, 用户每次打开表单看到的都是空输入框,
 * 若按常规语义提交就会把已有凭据清掉。清除须走显式的 clears 列表。
 */
export const adminModelApi = {
  config: () => request<AdminModelConfig>('/admin/model-config'),

  updateConfig: (settings: Record<string, unknown>, clears: string[] = [], reason?: string) =>
    request<{ updated: string[]; cleared: string[]; reason?: string }>('/admin/model-config', {
      method: 'PATCH',
      body: { settings, clears, ...(reason ? { reason } : {}) },
    }),

  /**
   * 连通性测试: 只探测可达性, 不发真实生成任务 (不消耗额度/不产垃圾图)。
   *
   * modality 决定探测哪个端点 (文 → /v1/chat/completions, 图 → 协议层声明的图像端点),
   * 缺省 image 与改造前行为一致。
   */
  testConfig: (
    modality?: Modality,
    overrides?: {
      protocol?: string;
      baseUrl?: string;
      token?: string;
      model?: string;
      enabled?: boolean;
    },
  ) =>
    request<AdminModelConfigTestResult>('/admin/model-config/test', {
      method: 'POST',
      body: { ...(modality ? { modality } : {}), ...(overrides ? { overrides } : {}) },
    }),

  /**
   * 批量测试全部通道 (2026-10-20)。
   *
   * 三个模态各有独立通道, 逐个点测试慢且易漏; 且「没配」在界面上
   * 看不出来的 (未接入 = 调用必然失败)。
   */
  testAllChannels: () =>
    request<AdminModelConfigTestAllResult>('/admin/model-config/test-all', {
      method: 'POST',
    }),

  /**
   * 厂商联动填充方案 (2026-10-20 厂商聚合后新增)。
   *
   * 厂商聚合后, 同一家的多个模态共享基址 (如硅基流动的图与文都是
   * api.siliconflow.cn), 但配置项仍按模态分开 (存量键不改名)。
   * 选厂商时一次性取回各模态该填什么, 免得手动在三个模态里填同一个基址。
   *
   * ⚠️ 不含令牌 —— 凭据仍按模态分开配置 (用户可能给图和文用不同的 key)。
   */
  vendorFillPlan: (vendorKey: string) =>
    request<AdminVendorFillPlan>(`/admin/model-config/vendor/${vendorKey}/fill-plan`),

  calls: (params: {    page?: number;
    pageSize?: number;
    capability?: string;
    source?: string;
    success?: boolean;
    fallback?: boolean;
    from?: string;
    to?: string;
  } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<AdminModelCallListResult>(`/admin/model-calls${suffix}`);
  },

  callDetail: (id: string) => request<AdminModelCall>(`/admin/model-calls/${id}`),
};

/**
 * 模型线路（多渠道）。
 *
 * 与 adminModelApi 的分工:
 *   - adminModelApi 管「旧版单通道参数 + 超时 + 路由」;
 *   - 本对象管「一条线路」的增删改/排序/启停/测试。
 * 一旦某模态有了线路，旧版单通道参数不再参与调度。
 */
export const adminModelChannelsApi = {
  list: () => request<AdminModelChannelsSnapshot>('/admin/model-channels'),

  create: (body: {
    modality: Modality;
    name: string;
    protocol: string;
    baseUrl?: string;
    token?: string;
    model?: string;
    enabled?: boolean;
    reason?: string;
  }) =>
    request<{ channel: AdminModelChannelRecord; materialized: boolean }>('/admin/model-channels', {
      method: 'POST',
      body,
    }),

  update: (
    id: string,
    body: {
      name?: string;
      protocol?: string;
      baseUrl?: string;
      token?: string;
      clearToken?: boolean;
      model?: string;
      enabled?: boolean;
      expectedUpdatedAt?: string;
      reason?: string;
    },
  ) =>
    request<{ channel: AdminModelChannelRecord }>(`/admin/model-channels/${id}`, {
      method: 'PATCH',
      body,
    }),

  remove: (id: string, reason?: string) =>
    request<{ deleted: boolean; remaining: number; sourceAfter: 'channels' | 'legacy' | 'none' }>(
      `/admin/model-channels/${id}`,
      { method: 'DELETE', body: reason ? { reason } : {} },
    ),

  move: (id: string, dir: 'up' | 'down') =>
    request<{ channels: AdminModelChannelRecord[] }>(`/admin/model-channels/${id}/move`, {
      method: 'POST',
      body: { dir },
    }),

  materialize: (modality: Modality, reason?: string) =>
    request<{ materialized: boolean; channels: AdminModelChannelRecord[] }>(
      '/admin/model-channels/materialize',
      { method: 'POST', body: { modality, ...(reason ? { reason } : {}) } },
    ),

  testSaved: (id: string) =>
    request<AdminChannelTestResult>(`/admin/model-channels/${id}/test`, { method: 'POST' }),

  testDraft: (body: {
    modality: Modality;
    id?: string;
    protocol?: string;
    baseUrl?: string;
    token?: string;
    model?: string;
    enabled?: boolean;
  }) => request<AdminChannelTestResult>('/admin/model-channels/test', { method: 'POST', body }),

  /**
   * 拉取厂商模型清单：内置预设 + 用令牌实时拉取的真实清单。
   * 只读，不落库、不改健康状态。
   */
  listModels: (body: {
    modality: Modality;
    id?: string;
    protocol?: string;
    baseUrl?: string;
    token?: string;
  }) => request<AdminModelListResult>('/admin/model-channels/models', { method: 'POST', body }),

  testAll: (modality?: Modality) =>
    request<AdminChannelTestAllResult>('/admin/model-channels/test-all', {
      method: 'POST',
      body: modality ? { modality } : {},
    }),
};

/**
 * 任务监控 (admin-prd.md B-28~B-33)。
 *
 * 重试与终止是**写操作**, 与只读的列表/详情分开放, 便于调用点自检:
 * 误把 retry 当查询调用的代价是真跑一次生成。
 */
export const adminTasksApi = {
  list: (params: {
    page?: number;
    pageSize?: number;
    status?: string;
    capability?: string;
    provider?: string;
    userId?: string;
    projectId?: string;
    from?: string;
    to?: string;
  } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<AdminTaskListResult>(`/admin/tasks${suffix}`);
  },

  /** 拥堵指标。独立拉取以便高频刷新告警条而不重载整页列表 */
  stats: () => request<AdminTaskCongestion>('/admin/tasks/stats'),

  detail: (id: string) => request<AdminTaskDetail>(`/admin/tasks/${id}`),

  /** 失败重试: 后端新建任务而非原地复活, 返回新任务 id */
  retry: (id: string, reason?: string) =>
    request<{ taskId: string; retriedFromId: string }>(`/admin/tasks/${id}/retry`, {
      method: 'POST',
      body: reason ? { reason } : {},
    }),

  /**
   * 终止等待中/执行中的任务。
   *
   * reason 会落进操作审计 —— 终止是作废用户已提交的动作, 事后必须能
   * 回答"谁、为什么", 故与 retry 一样把原因透传给后端。
   */
  cancel: (id: string, reason?: string) =>
    request<{ id: string; status: string; errorCode: string }>(`/admin/tasks/${id}/cancel`, {
      method: 'POST',
      body: reason ? { reason } : {},
    }),

  /** 批量重试 / 终止。状态限制逐条生效，失败原因逐条回传 */
  batch: (ids: string[], action: 'retry' | 'cancel', reason?: string) =>
    request<BatchSummary<unknown>>('/admin/tasks/batch', {
      method: 'POST',
      body: { ids, action, ...(reason ? { reason } : {}) },
    }),
};

/** 操作审计 (只读, 后端无删除接口) */
export const adminAuditApi = {
  list: (params: {
    actorId?: string;
    action?: string;
    targetId?: string;
    success?: boolean;
    page?: number;
    pageSize?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.actorId) qs.set('actorId', params.actorId);
    if (params.action) qs.set('action', params.action);
    if (params.targetId) qs.set('targetId', params.targetId);
    if (params.success !== undefined) qs.set('success', String(params.success));
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ result: AdminAuditListResult; actions: Array<{ action: string; count: number }> }>(
      `/admin/audit-logs${suffix}`,
    );
  },
};

/**
 * 数据备份与保留期。
 *
 * 下载走 blob 而非普通 request(): 响应是二进制, 走 JSON 剥壳逻辑会损坏内容。
 */
export const adminBackupsApi = {
  list: () => request<AdminBackup[]>('/admin/backups'),

  stats: () => request<AdminBackupStats>('/admin/backups/stats'),

  detail: (id: string) => request<AdminBackup>(`/admin/backups/${id}`),

  /**
   * 手动备份。同 idempotencyKey 在 5 秒内重复提交返回同一份。
   * reason 会写进操作审计 (backup.run 属高危权限), 不能省略。
   */
  run: (idempotencyKey?: string, reason?: string) =>
    request<AdminBackup>('/admin/backups', {
      method: 'POST',
      body: { idempotencyKey, reason },
    }),

  /** 恢复验证 B-97: 只读打开备份文件做完整性检查, 不触碰生产库 */
  verify: (id: string) =>
    request<AdminBackup>(`/admin/backups/${id}/verify`, { method: 'POST' }),

  /** 保留份数清理 */
  prune: (keepCount: number) =>
    request<{ removed: number; freedBytes: number }>('/admin/backups/prune', {
      method: 'POST',
      body: { keepCount },
    }),

  remove: (id: string) =>
    request<{ id: string; filename: string }>(`/admin/backups/${id}`, { method: 'DELETE' }),

  cleanupLogs: (limit = 50) => request<AdminCleanupLog[]>(`/admin/backups/cleanup-logs?limit=${limit}`),

  /** 到期数据清理 B-100 */
  cleanup: (target: string, retentionDays: number) =>
    request<{ target: string; deleted: number; cutoff: string }>('/admin/backups/cleanup', {
      method: 'POST',
      body: { target, retentionDays },
    }),

  /**
   * 下载备份。
   *
   * 单独走 fetch + blob: 后端返回的是二进制流, 走 request() 会被
   * unwrapEnvelope 当 JSON 解析而损坏。仅**已验证**的备份可下载 (B-97)。
   */
  download: async (id: string, filename: string): Promise<void> => {
    const res = await fetch(`${API_ROOT}/admin/backups/${id}/download`, {
      headers: { Authorization: `Bearer ${getToken() ?? ''}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(extractErrorMessage(body, '下载失败'));
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
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
      if (v !== undefined && v !== '') qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<AdminAssetListResult>(`/admin/assets${suffix}`);
  },

  stats: () => request<AdminAssetStats>('/admin/assets/stats'),

  impact: (id: string) =>
    request<{ sizeBytes: number; tasks: number; storageBackend: string }>(
      `/admin/assets/${id}/impact`,
    ),

  /** 下架/恢复。文件与记录都保留, 误操作可恢复 */
  setStatus: (id: string, status: AssetStatus) =>
    request<{ id: string; status: AssetStatus }>(`/admin/assets/${id}/status`, {
      method: 'PATCH',
      body: { status },
    }),

  /** 批量下架。每条仍写审计 —— 批量不等于免审计 */
  batchStatus: (ids: string[], status: AssetStatus) =>
    request<{ count: number; status: AssetStatus }>('/admin/assets/batch-status', {
      method: 'POST',
      body: { ids, status },
    }),

  remove: (id: string) =>
    request<{ id: string; removedTasks: number }>(`/admin/assets/${id}`, { method: 'DELETE' }),

  listProjects: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<AdminProjectListResult>(`/admin/projects${suffix}`);
  },

  removeProject: (id: string, hard = false) =>
    request<{ id: string; hard: boolean; impact: { assets: number; tasks: number; bytes: number } }>(
      `/admin/projects/${id}${hard ? '?hard=true' : ''}`,
      { method: 'DELETE' },
    ),

  /** 批量下架 / 恢复 / 删除。删除不可逆，权限单独校验 (asset.delete) */
  batch: (ids: string[], action: 'hide' | 'show' | 'delete', reason?: string) =>
    request<BatchSummary<unknown>>('/admin/assets/batch', {
      method: 'POST',
      body: { ids, action, ...(reason ? { reason } : {}) },
    }),

  /** 导出当前筛选结果 (CSV) */
  exportCsv: (params: Record<string, string | number | undefined> = {}) =>
    downloadCsv(`/admin/assets/export${toQuery(params)}`),
};

/** 存储后端管理 (B-62/B-63)。凭据只读, 界面不可编辑 */
export const adminStorageApi = {
  status: () => request<AdminStorageStatus>('/admin/storage/status'),

  probe: (backend?: string) =>
    request<{ backend: string; ok: boolean; message: string; latencyMs?: number }>(
      `/admin/storage/probe${backend ? `?backend=${backend}` : ''}`,
      { method: 'POST' },
    ),

  setActive: (backend: StorageBackendId) =>
    request<{ active: StorageBackendId; note: string }>(`/admin/storage/active?backend=${backend}`, {
      method: 'POST',
    }),
};

/**
 * 支付渠道状态 (只读)。
 *
 * 与存储配置同一安全边界: 凭据只从部署环境变量读, 页面没有任何写端点。
 * 切换通道 = 改 PAYMENT_PROVIDER 并重启, 不在界面里做 —— 支付通道改错
 * 的表现是「收款成功但账上没有钱」, 不能做成随手可点。
 */
export const adminPaymentChannelsApi = {
  status: () => request<AdminPaymentChannelStatus>('/admin/payment-channels'),
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
      if (v !== undefined && v !== '') qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ items: AdminCoupon[]; total: number; page: number; pageSize: number }>(
      `/admin/coupons${suffix}`,
    );
  },

  couponDetail: (id: string) => request<AdminCoupon>(`/admin/coupons/${id}`),

  createCoupon: (payload: UpsertCouponPayload) =>
    request<AdminCoupon>('/admin/coupons', { method: 'POST', body: payload }),

  updateCoupon: (id: string, payload: UpsertCouponPayload) =>
    request<AdminCoupon>(`/admin/coupons/${id}`, { method: 'PATCH', body: payload }),

  /** 启停切换。停用不影响已核销订单 */
  toggleCoupon: (id: string) =>
    request<AdminCoupon>(`/admin/coupons/${id}/toggle`, { method: 'PATCH' }),

  // ── 限时活动 (B-65) ─────────────────────────────────────────────
  campaigns: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ items: AdminCampaign[]; total: number; page: number; pageSize: number }>(
      `/admin/campaigns${suffix}`,
    );
  },

  createCampaign: (payload: UpsertCampaignPayload) =>
    request<AdminCampaign>('/admin/campaigns', { method: 'POST', body: payload }),

  updateCampaign: (id: string, payload: UpsertCampaignPayload) =>
    request<AdminCampaign>(`/admin/campaigns/${id}`, { method: 'PATCH', body: payload }),

  toggleCampaign: (id: string) =>
    request<AdminCampaign>(`/admin/campaigns/${id}/toggle`, { method: 'PATCH' }),

  // ── 邀请规则 (B-66) ─────────────────────────────────────────────
  inviteRule: () => request<InviteRule>('/admin/invites/rules'),
  updateInviteRule: (payload: InviteRule) =>
    request<InviteRule>('/admin/invites/rules', { method: 'PUT', body: payload }),

  /** 邀请关系列表 */
  invites: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<AdminInviteListResult>(`/admin/invites${suffix}`);
  },

  /**
   * 手动补发邀请奖励。
   *
   * ⚠ 后端此端点的权限点是 credit.adjust 而非 marketing.write ——
   * 它直接给人发积分, 与后台调整积分同性质。前端按钮须据此隐藏。
   */
  grantInviteReward: (id: string) =>
    request<{ granted: boolean; credits: number }>(`/admin/invites/${id}/grant`, { method: 'POST' }),

  // ── 签到规则 (B-67) ─────────────────────────────────────────────
  checkinRule: () => request<CheckinRule>('/admin/checkin/rules'),
  updateCheckinRule: (payload: CheckinRule) =>
    request<CheckinRule>('/admin/checkin/rules', { method: 'PUT', body: payload }),

  /** 签到记录 (发放量对账用) */
  checkins: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
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
  invites: () => request<MyInvites>('/marketing/invites'),

  /** 绑定邀请关系。注册成功后由前端调用 */
  bindInvite: (inviteCode: string) =>
    request<{ bound: boolean; relationId?: string; reason?: string }>('/marketing/invites/bind', {
      method: 'POST',
      body: { inviteCode },
    }),

  /** 签到状态 (今日是否已签 / 连签天数 / 未来 7 天可得) */
  checkinStatus: () => request<CheckinStatus>('/marketing/checkin'),

  /** 每日签到。重复调用幂等, 不重复发积分 */
  checkin: () =>
    request<{ alreadyCheckedIn: boolean; credits: number; streak: number }>('/marketing/checkin', {
      method: 'POST',
    }),

  /** 结算试算。不落库, 可反复调 */
  quote: (payload: { productIds: string[]; quantities: number[]; couponCode?: string }) =>
    request<MarketingQuote>('/marketing/quote', { method: 'POST', body: payload }),

  /**
   * 促销弹窗位。匿名也能取到 —— 落地页对未登录访客展示促销位是主要转化路径。
   * request() 在无 token 时不发 Authorization 头, 后端 OptionalJwtAuthGuard 放行
   */
  popup: () => request<PopupCampaign | null>('/marketing/popup'),

  /** 进行中的限时活动（落地页「限时活动」页签）。匿名可访问 */
  campaigns: () => request<PromoCampaign[]>('/marketing/campaigns'),
};

/**
 * 定时任务 (B-90)。
 *
 * 手动触发只开放幂等任务 (超时订单关闭/ 积分回收) —— 后端白名单控制,
 * 前端不自行判断哪些能跑。
 */
export const adminSchedulerApi = {
  status: () => request<AdminSchedulerStatus>('/admin/scheduler/status'),

  run: (task: string) =>
    request<{ name: string; skipped?: boolean; reason?: string }>(
      `/admin/scheduler/run?task=${task}`,
      { method: 'POST' },
    ),
};

// ────────────────────────────────────────────────────────────────────
// 交易后台 (B1): 商品 / 订单 / 支付流水 / 积分账本 / 保留期清理
// ────────────────────────────────────────────────────────────────────

/** 把对象拼成 query string, 空值一律跳过 (空串会让后端把筛选条件当成"等于空") */
function toQuery(params: Record<string, string | number | boolean | undefined>): string {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  });
  return qs.toString() ? `?${qs.toString()}` : '';
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
    headers: { Authorization: `Bearer ${getToken() ?? ''}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(extractErrorMessage(body, '导出失败'));
  }
  // 文件名以后端 Content-Disposition 为准, 没给才用调用方兜底
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const matched = /filename="?([^";]+)"?/.exec(disposition);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = matched?.[1] ?? filename ?? 'export.csv';
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
    headers: { Authorization: `Bearer ${getToken() ?? ''}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(extractErrorMessage(body, '打开失败'));
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
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
  list: (status?: 'active' | 'offline') =>
    request<AdminProduct[]>(`/admin/products${toQuery({ status })}`),

  create: (payload: CreateProductPayload) =>
    request<AdminProduct>('/admin/products', { method: 'POST', body: payload }),

  /** sku 不可改, 故 payload 里没有该字段 */
  update: (id: string, payload: UpdateProductPayload) =>
    request<AdminProduct>(`/admin/products/${id}`, { method: 'PATCH', body: payload }),

  setStatus: (id: string, status: 'active' | 'offline', reason?: string) =>
    request<{ id: string; status: string }>(`/admin/products/${id}/status`, {
      method: 'PATCH',
      body: { status, ...(reason ? { reason } : {}) },
    }),
};

/** 订单管理 (B-39~B-44) */
export const adminOrdersApi = {
  list: (params: {
    status?: string;
    orderNo?: string;
    email?: string;
    channel?: string;
    from?: string;
    to?: string;
    userId?: string;
    page?: number;
    pageSize?: number;
    sort?: string;
  } = {}) => request<AdminOrderListResult>(`/admin/orders${toQuery(params)}`),

  detail: (id: string) => request<AdminOrderDetail>(`/admin/orders/${id}`),

  exportCsv: (params: {
    status?: string;
    orderNo?: string;
    email?: string;
    channel?: string;
    from?: string;
    to?: string;
  } = {}) => downloadCsv(`/admin/orders/export${toQuery(params)}`),

  /**
   * 手工核销: 线下转账/渠道掉单时由财务确认。
   *
   * 幂等 —— 重复点击返回 idempotentHit=true 而非重复发积分。
   * 交易号用 `MANUAL-<管理员>-<时间戳>` 由后端生成, 不与渠道流水混在一起。
   */
  markPaid: (id: string) =>
    request<{ order: Order; idempotentHit: boolean; message?: string }>(
      `/admin/orders/${id}/mark-paid`,
      { method: 'POST' },
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
      state: 'succeeded' | 'processing';
      pending: boolean;
      refundedCents: number;
      fullyRefunded: boolean;
      creditsReclaimed: number;
      creditsUnreclaimable: number;
      message?: string;
    }>(`/admin/orders/${id}/refund`, { method: 'POST', body: { amountCents, reason } }),

  /** 批量核销。reason 必填（一次点错影响的人数比单笔多） */
  batchMarkPaid: (ids: string[], reason: string) =>
    request<BatchSummary<{ orderId: string; idempotentHit: boolean }>>('/admin/orders/batch', {
      method: 'POST',
      body: { ids, action: 'mark_paid', reason },
    }),
};

/** 支付流水 (B-45)。只读 —— 钱的动作一律在订单上做, 流水是既成事实 */
export const adminPaymentsApi = {
  list: (params: { status?: string; pageSize?: number; from?: string; to?: string } = {}) =>
    request<AdminPaymentRow[]>(`/admin/payments${toQuery(params)}`),

  exportCsv: (params: { status?: string; from?: string; to?: string } = {}) =>
    downloadCsv(`/admin/payments/export${toQuery(params)}`),
};

/** 积分账本 (B-49~B-52) */
export const adminCreditsApi = {
  list: (params: { userId?: string; email?: string; page?: number; pageSize?: number } = {}) =>
    request<AdminCreditListResult>(`/admin/credits${toQuery(params)}`),

  lots: (userId: string, params: { from?: string; to?: string } = {}) =>
    request<AdminCreditLotRow[]>(`/admin/credits/${userId}/lots${toQuery(params)}`),

  ledger: (
    userId: string,
    params: { type?: string; from?: string; to?: string; limit?: number } = {},
  ) => request<AdminCreditLedgerRow[]>(`/admin/credits/${userId}/ledger${toQuery(params)}`),

  adjust: (payload: { userId: string; delta: number; reason: string; validDays?: number }) =>
    request<{ userId: string; balance: number; delta: number }>('/admin/credits/adjust', {
      method: 'POST',
      body: payload,
    }),

  /** 批量调整。逐条独立执行, 返回每条结果 (一条失败不影响其余) */
  batchAdjust: (payload: {
    items: Array<{ userId: string; delta: number; reason?: string }>;
    reason: string;
    validDays?: number;
  }) =>
    request<AdminBatchAdjustResult>('/admin/credits/batch-adjust', {
      method: 'POST',
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
  importCsv: (file: File, opts: { reason?: string; validDays?: number } = {}) => {
    const form = new FormData();
    form.append('file', file);
    if (opts.reason) form.append('reason', opts.reason);
    if (opts.validDays !== undefined) form.append('validDays', String(opts.validDays));
    return request<CreditImportResult>('/admin/credits/import', {
      method: 'POST',
      body: form,
    });
  },
};

/**
 * 保留期清理 (B-96)。
 *
 * 与 adminBackupsApi.cleanup 的区别: 后者是旧端点 (无原因字段),
 * 这里强制填原因 —— 删除历史数据必须能回答"谁删的、为什么"。
 */
export const adminRetentionApi = {
  targets: () => request<AdminRetentionTarget[]>('/admin/retention/targets'),

  logs: (pageSize = 50) => request<AdminCleanupLog[]>(`/admin/retention/logs?pageSize=${pageSize}`),

  cleanup: (target: string, retentionDays: number, reason: string) =>
    request<{ target: string; deleted: number; cutoff: string }>('/admin/retention/cleanup', {
      method: 'POST',
      body: { target, retentionDays, reason },
    }),
};

/**
 * 后台发票审核 (B3)。权限 invoice.write。
 *
 * 开具与驳回都必须给说明 —— 票面金额与抬头是财务凭证, 事后要能解释。
 */
export const adminInvoicesApi = {
  list: (params: { status?: InvoiceStatus; keyword?: string; limit?: number; offset?: number } = {}) =>
    request<{ items: AdminInvoice[]; total: number }>(`/admin/invoices${toQuery(params)}`),

  issue: (id: string, reason: string) =>
    request<AdminInvoice>(`/admin/invoices/${id}/issue`, { method: 'POST', body: { reason } }),

  reject: (id: string, reason: string) =>
    request<AdminInvoice>(`/admin/invoices/${id}/reject`, { method: 'POST', body: { reason } }),

  preview: (id: string) => openHtmlDocument(`/admin/invoices/${id}/file`),
};

/**
 * 渠道对账 (B3)。
 *
 * 读取用 payment.read (运营排障), 导入与处置用 finance.reconcile (仅财务) ——
 * 处置会让差异从看板上消失, 这是财务口径的责任。
 */
export const adminReconciliationApi = {
  batches: (limit = 20, offset = 0) =>
    request<{ items: ReconciliationBatch[]; total: number }>(
      `/admin/reconciliation/batches?limit=${limit}&offset=${offset}`,
    ),

  batch: (id: string) => request<ReconciliationBatchDetail>(`/admin/reconciliation/batches/${id}`),

  /** 导入渠道账单 (multipart: file + channel + billDate) */
  importFile: (file: File, channel: string, billDate: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('channel', channel);
    fd.append('billDate', billDate);
    return request<ReconciliationBatchDetail>('/admin/reconciliation/import', {
      method: 'POST',
      body: fd,
    });
  },

  resolve: (itemId: string, status: 'resolved' | 'ignored', note: string) =>
    request<ReconciliationItem>(`/admin/reconciliation/items/${itemId}/resolve`, {
      method: 'POST',
      body: { status, note },
    }),

  exportCsv: (batchId: string) =>
    downloadCsv(`/admin/reconciliation/batches/${batchId}/export`),
};


/**
 * 账户自助 (B4)。
 *
 * 路径全部用 `/me`：路由层面就没有「别人的账号」这个概念，
 * 不可能因为漏校验 :id 而越权。
 */
export const meApi = {
  profile: () => request<MyProfile>('/me'),

  update: (data: { name?: string }) =>
    request<{ id: string; email: string; name: string }>('/me', { method: 'PATCH', body: data }),

  /** 改密成功后该账号全部旧 token 失效（含当前这把），调用方必须跳登录 */
  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ changed: true }>('/me/password', {
      method: 'POST',
      body: { oldPassword, newPassword },
    }),

  /** 个人数据导出（JSON）。调用方负责用 Blob 下载 */
  exportData: () => request<Record<string, unknown>>('/me/export', { method: 'POST' }),

  deletionPreview: () => request<DeletionPreview>('/me/deletion-preview'),

  /** 自助注销：密码 + 确认词「注销」 */
  deleteAccount: (password: string, confirm: string) =>
    request<{ id: string; deleted: boolean }>('/me', {
      method: 'DELETE',
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
  index: () => request<LegalIndexItem[]>('/legal'),
  current: (slug: string) => request<LegalDoc | null>(`/legal/${slug}`),
};

/** 站内消息 */
export const notificationsApi = {
  list: (params: { unreadOnly?: boolean; limit?: number } = {}) =>
    request<NotificationList>(`/notifications${toQuery(params)}`),

  read: (id: string) => request<{ id: string; read: boolean; unread: number }>(`/notifications/${id}/read`, { method: 'POST' }),

  readAll: () => request<{ updated: number; unread: number }>('/notifications/read-all', { method: 'POST' }),
};

/** 后台：法务文档版本管理 */
export const adminLegalApi = {
  versions: (slug?: string) =>
    request<AdminLegalDoc[]>(`/admin/legal${slug ? `?slug=${encodeURIComponent(slug)}` : ''}`),

  upsert: (data: {
    slug: string;
    version: string;
    title: string;
    content: string;
    status?: 'draft' | 'published' | 'archived';
    /** 高危动作的操作原因，只落审计 */
    reason?: string;
  }) => request<AdminLegalDoc>('/admin/legal', { method: 'PUT', body: data }),

  publish: (slug: string, version: string, reason?: string) =>
    request<AdminLegalDoc>(`/admin/legal/${encodeURIComponent(slug)}/${encodeURIComponent(version)}/publish`, {
      method: 'POST',
      body: { reason: reason ?? '' },
    }),
};

/** 后台：站内消息广播与模板 */
export const adminNotificationsApi = {
  broadcast: (data: { title: string; body: string; link?: string }) =>
    request<{ sent: number; users: number }>('/admin/notifications/broadcast', {
      method: 'POST',
      body: data,
    }),

  templates: () => request<MessageTemplateItem[]>('/admin/notifications/templates'),

  /** 邮件 / 短信通道实际生效的实现（console = 不真实投递） */
  channels: () => request<DeliveryChannelStatusMap>('/admin/notifications/channels'),

  upsertTemplate: (data: {
    code: string;
    channel: 'inapp' | 'email' | 'sms';
    subject?: string;
    body: string;
    enabled?: boolean;
  }) =>
    request<MessageTemplateItem>('/admin/notifications/templates', {
      method: 'POST',
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
    request<Ticket>('/tickets', { method: 'POST', body: payload }),

  detail: (id: string) => request<Ticket>(`/tickets/${id}`),

  /** 用户回复。resolved 会回落到 open；closed 后端拒绝 */
  reply: (id: string, content: string) =>
    request<Ticket>(`/tickets/${id}/replies`, { method: 'POST', body: { content } }),

  close: (id: string) => request<Ticket>(`/tickets/${id}/close`, { method: 'POST' }),
};

/** 后台工单处理中心 */
export const adminTicketsApi = {
  stats: () => request<TicketStats>('/admin/tickets/stats'),

  list: (params: {
    status?: string;
    type?: string;
    priority?: string;
    assigneeId?: string;
    q?: string;
    limit?: number;
    offset?: number;
  } = {}) => request<AdminTicketListResult>(`/admin/tickets${toQuery(params)}`),

  detail: (id: string) => request<AdminTicketDetail>(`/admin/tickets/${id}`),

  reply: (id: string, content: string, reason?: string) =>
    request<AdminTicketDetail>(`/admin/tickets/${id}/replies`, {
      method: 'POST',
      body: { content, ...(reason ? { reason } : {}) },
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
      reason?: string;
    },
  ) => request<AdminTicketDetail>(`/admin/tickets/${id}`, { method: 'PATCH', body: payload }),

  exportCsv: (params: {
    status?: string;
    type?: string;
    priority?: string;
    q?: string;
  } = {}) => downloadCsv(`/admin/tickets/export${toQuery(params)}`),
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
