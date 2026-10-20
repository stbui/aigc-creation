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
  AdminVendorFillPlan,
  Modality,
  AdminOverview,
  AdminPasswordReset,
  AdminPermissionCatalog,
  AdminRoleItem,
  AdminSettings,
  AdminSettingField,
  AdminUserDetail,
  AdminUserImpact,
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
  MyInvites,
  CheckinStatus,
  MarketingQuote,
  PopupCampaign,
  AssetListResult,
  AssetUploadResponse,
  AuthResponse,
  GenerateRequest,
  GenerateResponse,
  LoginRequest,
  Project,
  RegisterRequest,
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
  AdminCreditPrice,
  MembershipPlan,
  MyMembership,
  PromptToolResult,
  MobileUploadSessionCreated,
  MobileUploadSessionStatus,
} from '../types/api';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
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
      } else {
        window.dispatchEvent(new Event('auth:required'));
      }
    }
    let message = `请求失败（${res.status}）`;
    try {
      message = extractErrorMessage(await res.json(), message);
    } catch {
      /* 保留默认文案 */
    }
    if (res.status === 401 && !getToken()) message = '请先登录';
    throw new ApiError(message, res.status);
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

export const authApi = {
  login: (data: LoginRequest) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: data }),
  register: (data: RegisterRequest) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: data }),
};

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
  start: (data: GenerateRequest) =>
    request<GenerateResponse>('/generate', { method: 'POST', body: data }),
  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  list: () => request<TaskListResult>('/tasks').then((r) => asList<Task>(r)),
  remove: (id: string) => request<{ id: string; removedAsset: boolean }>(`/tasks/${id}`, { method: 'DELETE' }),
};

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
  /** 下单。幂等键重复提交返回同一订单 */
  create: (params: {
    productId: string;
    quantity: number;
    idempotencyKey: string;
    couponCode?: string;
  }) =>
    request<Order>('/orders', {
      method: 'POST',
      body: {
        productId: params.productId,
        quantity: params.quantity,
        idempotencyKey: params.idempotencyKey,
        ...(params.couponCode ? { couponCode: params.couponCode } : {}),
      },
    }),
  list: () => request<Order[]>('/orders'),
  detail: (id: string) => request<Order>(`/orders/${id}`),

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
   * modality 决定探测哪个端点 (文 → /v1/chat/completions, 图 → /generation/tasks),
   * 缺省 image 与改造前行为一致。
   */
  testConfig: (modality?: Modality) =>
    request<AdminModelConfigTestResult>('/admin/model-config/test', {
      method: 'POST',
      body: modality ? { modality } : {},
    }),

  /**
   * 批量测试全部通道 (2026-10-20)。
   *
   * 三个模态各有独立通道, 逐个点测试慢且易漏; 且「没配」在界面上
   * 看不出来的 (视频/文本无本地兜底, 未接入 = 调用必然失败)。
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

  /** 手动备份。同 idempotencyKey 在 5 秒内重复提交返回同一份 */
  run: (idempotencyKey?: string) =>
    request<AdminBackup>('/admin/backups', {
      method: 'POST',
      body: { idempotencyKey },
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
