import { downloadCsv, request, toQuery } from "./api";

import type {
  AdminAssetListResult,
  AdminAssetStats,
  AdminProjectListResult,
  AdminStorageProbeResult,
  AdminStorageSaveConfigResult,
  AdminStorageStatus,
  AssetStatus,
  BatchSummary,
  Project,
  StorageBackendId,
} from "../types/api";

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

/** 存储后端管理 (B-62/B-63)。2026-11 起凭据支持页面编辑（加密落库） */
export const adminStorageApi = {
  status: () => request<AdminStorageStatus>("/admin/storage/status"),

  /** 保存后端配置，即时生效；密钥留空表示沿用旧值（local 只保存公开访问地址） */
  saveConfig: (backend: StorageBackendId, values: Record<string, string>) =>
    request<AdminStorageSaveConfigResult>(`/admin/storage/config/${backend}`, {
      method: "PUT",
      body: { values },
    }),

  /**
   * 连通性测试。传 values = 用页面草稿测（不落库、不切换默认后端）；
   * 不传则探测已保存的 provider。两者都会真实读写 1 字节探针。
   */
  probe: (backend?: string, values?: Record<string, string>) =>
    request<AdminStorageProbeResult>(
      `/admin/storage/probe${backend ? `?backend=${backend}` : ""}`,
      {
        method: "POST",
        ...(values ? { body: { values } } : {}),
      },
    ),

  setActive: (backend: StorageBackendId) =>
    request<{ active: StorageBackendId; note: string }>(
      `/admin/storage/active?backend=${backend}`,
      {
        method: "POST",
      },
    ),
};
