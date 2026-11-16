/**
 * 用户管理的类型出口 —— 目录内文件的唯一类型来源。
 *
 * 外部类型（`types/api`、`types/admin-users`）在此统一 re-export，业务文件
 * 一律从 `./types` 取；本目录派生的结构与查询类型也定义于此。
 */

import type { AdminUserListResult } from '../../../types/api';

/* 外部类型统一转出 */
export type {
  AdminUserListResult,
  AdminLoginLogResult,
  AdminUserDetail,
  AdminPasswordReset,
} from '../../../types/api';
export type {
  AdminUserMembership,
  AdminUserMembershipHistoryItem,
  AdminUserImpact,
  AdminUserRecentOrder,
  AdminUserSpending,
  AdminUserGeneration,
} from '../../../types/admin-users';

/** 用户列表与详情共用的一行数据结构。 */
export type AdminUserRow = AdminUserListResult['items'][number];
export type AdminUserRole = AdminUserRow['role'];
export type AdminUserStatus = AdminUserRow['status'];

/**
 * 删除确认只需要 id 与 email：列表行有完整字段，详情抽屉只有详情对象。
 * 收窄成最小形状，两处入口才能共用同一个 `deleteTarget` 与确认弹框。
 */
export type DeleteUserTarget = Pick<AdminUserRow, 'id' | 'email'>;

export type AdminUserSegment = 'never_login' | 'inactive_30d' | 'no_tasks';
export type AdminUserMembershipFilter = 'member' | 'non_member';

/** 用户列表查询参数。列表组件只读写已经收窄过的值。 */
export interface AdminUserListQuery {
  page: number;
  pageSize: number;
  keyword?: string;
  role?: AdminUserRole;
  status?: AdminUserStatus;
  from?: string;
  to?: string;
  segment?: AdminUserSegment;
  membership?: AdminUserMembershipFilter;
  sort?: string;
}
