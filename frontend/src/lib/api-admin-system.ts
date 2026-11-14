import { request, toQuery, downloadCsv } from "./api";
import { API_ROOT, formDataWithFile, extractErrorMessage } from "./http";
import { getToken } from "./auth";
import type { AdminAigcLabel, AdminAssetListResult, AdminAssetStats, AdminBackup, AdminBackupStats, AdminLoginLogResult, AdminPasswordReset, AdminProjectListResult, AdminRoleItem, AdminSettingImageUpload, AdminSettings, AdminSettingsUpdatePayload, AdminSettingsUpdateResult, AdminStorageStatus, AdminTaskCongestion, AdminTaskDetail, AdminTaskListResult, AdminTemplateCatalog, AdminTemplateCategory, AdminTemplateGroup, AdminTemplateItem, AdminUserDetail, AdminUserListResult, AdminUserStats, AigcLabelSpec, AssetStatus, BatchSummary, Project, StorageBackendId } from "../types/api";
import type { AdminUserImpact } from "../types/admin-users";

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
      from?: string;
      to?: string;
      segment?: string;
      membership?: string;
      page?: number;
      pageSize?: number;
      sort?: string;
    } = {},
  ) => request<AdminUserListResult>(`/admin/users${toQuery(params)}`),

  /** 全局统计，跟随当前筛选条件 */
  stats: (
    params: {
      keyword?: string;
      role?: string;
      status?: string;
      from?: string;
      to?: string;
      segment?: string;
      membership?: string;
    } = {},
  ) => request<AdminUserStats>(`/admin/users/stats${toQuery(params)}`),

  detail: (id: string) => request<AdminUserDetail>(`/admin/users/${id}`),
  /** 最近登录记录。权限 user.read —— 无权限时 403，前端按「不可见」处理 */
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

  /** 强制下线：保留账号可用性，只让已签发 token 立即失效 */
  logoutAll: (id: string) =>
    request<{ id: string; revoked: boolean }>(`/admin/users/${id}/logout-all`, {
      method: "POST",
    }),

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

  /** 导出当前筛选结果 (CSV, 上限 5000 行；截断时返回元数据) */
  exportCsv: (
    params: {
      keyword?: string;
      role?: string;
      status?: string;
      from?: string;
      to?: string;
      segment?: string;
      membership?: string;
      sort?: string;
    } = {},
  ) => downloadCsv(`/admin/users/export${toQuery(params)}`),

  /**
   * 批量启用/禁用/注销。逐条结果 —— 一条失败不影响其余。
   *
   * `action=delete` 固定走软注销，必须带确认词（服务端校验），单次上限 20 条。
   * 确认词由调用方固定传 `BATCH_DELETE_CONFIRM`，界面不再要求运营手工键入。
   */
  batch: (
    ids: string[],
    action: "disable" | "enable" | "delete",
    confirm?: string,
  ) =>
    request<BatchSummary<{ id: string; status?: string; hard?: boolean }>>(
      "/admin/users/batch",
      {
        method: "POST",
        body: { ids, action, confirm },
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
  uploadImage: (file: File) => request<AdminSettingImageUpload>("/admin/settings/upload", { method: "POST", body: formDataWithFile("file", file) }),
  update: (payload: AdminSettingsUpdatePayload) =>
    request<AdminSettingsUpdateResult>("/admin/settings", { method: "PATCH", body: payload }),
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
 * 写真模板目录（/admin/templates）。
 *
 * 三级结构：一级分类（来源文章/主题）→ 二级分类（风格/场景）→ 模板（图 + 提示词 + 标签）。
 * 图片上传只返回稳定引用与预览地址，条目保存时再把引用写入 `imageUrl`。
 */
export const adminTemplateCatalogApi = {
  catalog: () => request<AdminTemplateCatalog>("/admin/templates/catalog"),

  createCategory: (payload: {
    slug: string;
    name: string;
    sourceUrl?: string;
    description?: string;
    sortOrder?: number;
    enabled?: boolean;
  }) => request<AdminTemplateCategory>("/admin/templates/categories", { method: "POST", body: payload }),

  updateCategory: (
    id: string,
    payload: Partial<{
      slug: string;
      name: string;
      sourceUrl: string;
      description: string;
      sortOrder: number;
      enabled: boolean;
    }>,
  ) => request<AdminTemplateCategory>(`/admin/templates/categories/${id}`, { method: "PATCH", body: payload }),

  removeCategory: (id: string) =>
    request<{ id: string; name: string; removedGroups: number; removedItems: number }>(
      `/admin/templates/categories/${id}`,
      { method: "DELETE" },
    ),

  createGroup: (payload: {
    categoryId: string;
    slug: string;
    name: string;
    sortOrder?: number;
    enabled?: boolean;
  }) => request<AdminTemplateGroup>("/admin/templates/groups", { method: "POST", body: payload }),

  updateGroup: (
    id: string,
    payload: Partial<{ slug: string; name: string; sortOrder: number; enabled: boolean }>,
  ) => request<AdminTemplateGroup>(`/admin/templates/groups/${id}`, { method: "PATCH", body: payload }),

  removeGroup: (id: string) =>
    request<{ id: string; name: string; removedItems: number }>(`/admin/templates/groups/${id}`, {
      method: "DELETE",
    }),

  createItem: (payload: {
    groupId: string;
    name: string;
    prompt: string;
    imageUrl: string;
    tags?: string[];
    sortOrder?: number;
    enabled?: boolean;
  }) => request<AdminTemplateItem>("/admin/templates/items", { method: "POST", body: payload }),

  updateItem: (
    id: string,
    payload: Partial<{
      name: string;
      prompt: string;
      imageUrl: string;
      tags: string[];
      sortOrder: number;
      enabled: boolean;
    }>,
  ) => request<AdminTemplateItem>(`/admin/templates/items/${id}`, { method: "PATCH", body: payload }),

  removeItem: (id: string) =>
    request<{ id: string; name: string }>(`/admin/templates/items/${id}`, { method: "DELETE" }),

  uploadImage: (file: File) =>
    request<{ imageUrl: string; previewUrl: string; width: number; height: number; sizeBytes: number }>(
      "/admin/templates/upload",
      { method: "POST", body: formDataWithFile("file", file) },
    ),
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
      userId?: string;
      projectId?: string;
      errorCode?: string;
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
      userId?: string;
      projectId?: string;
      errorCode?: string;
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

  /** 批量下架。文件与记录都保留, 误操作可恢复。 */
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

  createProject: (payload: { name: string; ownerId: string }) =>
    request<Project>("/admin/projects", {
      method: "POST",
      body: payload,
    }),

  updateProject: (id: string, name: string) =>
    request<Project>(`/admin/projects/${id}`, {
      method: "PATCH",
      body: { name },
    }),

  /** 软删除项目；有素材时必须指定同用户的迁移目标。 */
  removeProject: (id: string, moveAssetsTo?: string) =>
    request<{
      id: string;
      hard: boolean;
      deprecatedHard: true;
      deletedAt: string;
      movedAssets: number;
      retained: { assets: number; tasks: number };
    }>(`/admin/projects/${id}${moveAssetsTo ? `?moveAssetsTo=${encodeURIComponent(moveAssetsTo)}` : ""}`, {
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

