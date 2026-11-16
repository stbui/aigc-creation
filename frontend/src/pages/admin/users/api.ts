/**
 * 用户管理的接口入口 —— 目录内文件的唯一外部接口来源。
 *
 * 本模块持有的 `adminUsersApi` 在此完整定义，业务文件一律从 `./api` 取用，
 * 调用形式保持 `adminUsersApi.xxx()`。
 */

import { request, toQuery, downloadCsv } from '../../../lib/api';
import type {
  AdminUserDetail,
  AdminUserListResult,
  AdminUserStats,
  AdminLoginLogResult,
  AdminPasswordReset,
  BatchSummary,
} from '../../../types/api';
import type { AdminUserImpact } from '../../../types/admin-users';

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
