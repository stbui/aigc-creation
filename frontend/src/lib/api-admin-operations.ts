import { downloadCsv, request, toQuery } from "./api";
import { getToken } from "./auth";
import { API_ROOT, extractErrorMessage } from "./http";

import type {
  AdminBackup,
  AdminBackupStats,
  AdminTaskCongestion,
  AdminTaskDetail,
  AdminTaskListResult,
  BatchSummary,
} from "../types/api";

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
