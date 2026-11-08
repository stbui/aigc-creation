import { useCallback } from 'react';
import { PageHeader } from '~/admin-ui/primitives';
import { useAdmin, useAdminDetailParam } from './hooks';
import { useAdminUserActions } from './useAdminUserActions';
import { useAdminUserFilters } from './useAdminUserFilters';
import { UserDetailDrawer } from './UserDetailDrawer';
import { UserDeleteConfirm } from './UserDeleteConfirm';
import { UserFilters } from './UserFilters';
import { UserListSection } from './UserListSection';
import { UserRoleConfirm } from './UserRoleConfirm';
import { UserStatusConfirm } from './UserStatusConfirm';
import { TempPasswordDialog } from './TempPasswordDialog';

/**
 * 用户管理。
 *
 * 页面只负责组合列表、筛选与操作弹框；查询生命周期、URL 同步、导出和写操作
 * 分别由独立 hook 承载，避免一个组件同时管理三套不相关的状态。
 *
 * 删除固定走软注销：清空作品数据并匿名化账号，资金记录依法保留。
 */
export function AdminUsersPage() {
  const { can } = useAdmin();
  const [detailId, setDetailId] = useAdminDetailParam();
  const filters = useAdminUserFilters();

  const openUser = useCallback((id: string) => setDetailId(id), [setDetailId]);
  const closeUser = useCallback(() => setDetailId(null), [setDetailId]);
  const actions = useAdminUserActions({
    reload: filters.reload,
    onDeleted: closeUser,
  });

  return (
    <div className="w-full">
      <PageHeader
        title="用户管理"
        description="管理注册用户的账号状态、角色与资源"
        inlineDescription
        className="mb-3"
      />

      <UserFilters
        keyword={filters.keyword}
        onKeywordChange={filters.setKeyword}
        role={filters.role}
        onRoleChange={filters.setRole}
        status={filters.status}
        onStatusChange={filters.setStatus}
        appliedChips={filters.appliedChips}
        onApply={filters.applyFilters}
        onReset={filters.resetFilters}
        sort={filters.sort}
        onSortChange={(sort) => filters.setQuery({ sort })}
        canExport={can('data.export')}
        exporting={filters.exporting}
        onExport={() => void filters.exportUsers()}
      />

      <UserListSection
        data={filters.data}
        loading={filters.loading}
        error={filters.error}
        hasFilter={filters.hasFilter}
        onRetry={filters.reload}
        onResetFilters={filters.resetFilters}
        onOpenUser={openUser}
        actionsFor={actions.rowActions}
        onPageChange={filters.setPage}
      />

      <UserDetailDrawer detailId={detailId} onClose={closeUser} />

      {actions.statusTarget && (
        <UserStatusConfirm
          target={actions.statusTarget}
          loading={actions.busy}
          onCancel={actions.closeStatus}
          onConfirm={(next) => void actions.updateStatus(next)}
        />
      )}

      {actions.roleTarget && (
        <UserRoleConfirm
          target={actions.roleTarget}
          loading={actions.busy}
          onCancel={actions.closeRole}
          onConfirm={(role) => void actions.updateRole(role)}
        />
      )}

      {actions.deleteTarget && (
        <UserDeleteConfirm
          target={actions.deleteTarget}
          loading={actions.busy}
          onCancel={actions.closeDelete}
          onConfirm={() => void actions.confirmDelete()}
        />
      )}

      {actions.tempPassword && (
        <TempPasswordDialog
          password={actions.tempPassword}
          onClose={actions.closeTempPassword}
        />
      )}
    </div>
  );
}
