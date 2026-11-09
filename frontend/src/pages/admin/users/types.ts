import type { AdminUserListResult } from '../../../types/api';

/** 用户列表与详情共用的一行数据结构。 */
export type AdminUserRow = AdminUserListResult['items'][number];
export type AdminUserRole = AdminUserRow['role'];
export type AdminUserStatus = AdminUserRow['status'];

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
