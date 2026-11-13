import { request, toQuery } from "./api";
import { API_ROOT } from "./http";
import type { Asset, AssetListResult, AssetUploadResponse, AuthResponse, GenerateRequest, GenerateResponse, LoginRequest, MobileUploadSessionCreated, MobileUploadSessionStatus, PortraitTemplatesResult, Project, ProjectListItem, PromptToolResult, QrCreateResult, QrStatusResult, RegisterRequest, ShoppableCarouselTemplatesResult, SmsLoginRequest, SmsPurpose, StatsOverview, Task, TaskListResult, TaskPageResult } from "../types/api";

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
  register: (data: RegisterRequest) => request<AuthResponse>("/auth/register", { method: "POST", body: data }), sendEmail: (email: string) => request<{ sent: true; delivered: boolean }>("/auth/email/send", { method: "POST", body: { email } }),

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
  oauthProviders: () => request<OAuthProviderInfo[]>("/auth/oauth/providers"), linkOauth: (provider: string, returnTo?: string) => request<{ url: string }>(`/auth/oauth/${encodeURIComponent(provider)}/link${toQuery(returnTo ? { returnTo } : {})}`),

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
  list: () => request<ProjectListItem[]>("/projects"),
  create: (name: string) =>
    request<Project>("/projects", { method: "POST", body: { name } }),
  update: (id: string, name: string) =>
    request<Project>(`/projects/${id}`, { method: "PATCH", body: { name } }),
  remove: (id: string, moveAssetsTo?: string) =>
    request<{ id: string; deletedAt: string; movedAssets: number }>(
      `/projects/${id}${moveAssetsTo ? `?moveAssetsTo=${encodeURIComponent(moveAssetsTo)}` : ""}`,
      { method: "DELETE" },
    ),
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
      excludeFailed?: boolean;
    } = {},
  ) => {
    const qs = new URLSearchParams({ limit: String(params.limit ?? 50), offset: String(params.offset ?? 0) });
    if (params.capability) qs.set("capability", params.capability);
    if (params.projectId) qs.set("projectId", params.projectId);
    if (params.excludeFailed) qs.set("excludeFailed", "1");
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
 * 写真模板清单 (公开, 免登录)。
 *
 * 模板是能力定义的一部分 (决定提交给模型的风格提示词), 事实源在后端
 * `capabilities/definitions/template.templates.ts`。前端不另存一份清单 ——
 * 两份清单漂移时, 用户选中的模板会与后端查不到的那份对不上。
 *
 * 缩略图是本仓库静态文件, 接口只给相对路径, 运行时不请求外部站点。
 */
export const templateApi = {
  templates: () => request<PortraitTemplatesResult>("/template/templates"),
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
      status: "waiting" | "receiving" | "received" | "expired";
      assetId: string | null;
      assets: Array<{ id: string; url: string; filename: string }>;
    }>(`/mobile-upload/sessions/${encodeURIComponent(sessionId)}/receive`, {
      method: "POST",
      body: fd,
    });
  },
};

