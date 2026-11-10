import { request, toQuery, downloadCsv } from "./api";
import type { AdminLegalDoc, AdminTicketAssignee, AdminTicketDetail, AdminTicketListResult, CreateTicketPayload, DeletionPreview, DeliveryChannelStatusMap, LegalDoc, LegalIndexItem, MessageTemplateItem, MyProfile, NotificationList, Ticket, TicketListResult, TicketStats } from "../types/api";

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
  changePassword: (oldPassword: string | undefined, newPassword: string) =>
    request<{ changed: true }>("/me/password", {
      method: "POST",
      body: { ...(oldPassword ? { oldPassword } : {}), newPassword },
    }),

  /** 个人数据导出（JSON）。调用方负责用 Blob 下载 */
  exportData: () =>
    request<Record<string, unknown>>("/me/export", { method: "POST" }),

  deletionPreview: () => request<DeletionPreview>("/me/deletion-preview"),

  /** 自助注销：密码 + 确认词「注销」 */
  deleteAccount: (password: string | undefined, confirm: string) =>
    request<{ id: string; deleted: boolean }>("/me", {
      method: "DELETE",
      body: { ...(password ? { password } : {}), confirm },
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

  /** 可指派的启用后台账号 */
  assignees: () => request<AdminTicketAssignee[]>("/admin/tickets/assignees"),

  reply: (id: string, content: string, visibility: "public" | "internal" = "public") =>
    request<AdminTicketDetail>(`/admin/tickets/${id}/replies`, {
      method: "POST",
      body: { content, visibility },
    }),

  /** 转交：内部备注 + 指派 + processing；不改钱 */
  transfer: (id: string, assigneeId: string, note?: string) =>
    request<AdminTicketDetail>(`/admin/tickets/${id}/transfer`, {
      method: "POST",
      body: { assigneeId, ...(note?.trim() ? { note: note.trim() } : {}) },
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

