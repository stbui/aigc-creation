import { request, toQuery } from "./api";
import type { AdminChannelModelListItem, AdminChannelModelView, AdminChannelView, AdminLogicalModelView, BillingBatchResolveResult, BillingOrderListResult, BillingOrderView, ChannelHealthRowView, ChannelModelFetchResultView, ChannelModelHealthRowView, ChannelModelRepriceInput, ChannelOrderItemView, ChannelPageResult, ModelIntentPayload, PluginListResult, PluginVerifyResultView, PluginView, ProtocolCatalogEntryView, ProtocolTestResultView, ProviderCatalogView, ProviderVerifyResult, SimulateResultView, SystemChannelExportView, SystemChannelImportResultView, UpstreamModelPreview, UserGroupView } from "../types/model";

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

  /**
   * 解除本进程内全部线路冷却。
   *
   * 只清内存、不动数据库；多实例部署时只影响处理本次请求的实例。
   */
  resetHealth: () =>
    request<{ cleared: number }>("/admin/channels/health/reset", {
      method: "POST",
    }),

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
   * 删除是业务操作，保留前端确认。渠道模型删除同样不要求填写原因。
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
   * 删除保留业务确认，不要求填写原因。
   */
  removeModel: (id: string, modelId: string) =>
    request<{ deleted: number }>(`/admin/channels/${id}/models/${modelId}`, {
      method: "DELETE",
    }),

  /**
   * 批量删除渠道模型（全有或全无）。
   *
   * 删除保留业务确认，不要求填写原因。
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
