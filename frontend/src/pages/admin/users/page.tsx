import { useCallback, useEffect, useState } from 'react';
import { AdminPage } from '~/admin-ui/primitives';
import { useAdmin, useAdminDetailParam } from './hooks';
import { useAdminUserActions } from './useAdminUserActions';
import { useAdminUserFilters } from './useAdminUserFilters';
import { UserDetailDrawer } from './UserDetailDrawer';
import { UserDeleteConfirm } from './UserDeleteConfirm';
import { BatchDeleteUsersDialog } from '~/components/admin/BatchDeleteUsersDialog';
import { UserFilters } from './UserFilters';
import { UserListSection, type UserListView } from './UserListSection';
import { UserLogoutConfirm } from './UserLogoutConfirm';
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
  const { can, me } = useAdmin();
  const [detailId, setDetailId] = useAdminDetailParam();
  const [view, setView] = useState<UserListView>('cards');
  const [selected, setSelected] = useState<string[]>([]);
  const filters = useAdminUserFilters();

  const openUser = useCallback((id: string) => setDetailId(id), [setDetailId]);
  const closeUser = useCallback(() => setDetailId(null), [setDetailId]);
  const actions = useAdminUserActions({
    reload: filters.reload,
    onDeleted: closeUser,
    // 批量注销后列表里已经没有这些人，勾选与可能打开的抽屉都要一起清掉
    onBatchDeleted: () => {
      setSelected([]);
      closeUser();
    },
  });

  // 筛选/排序变化后，上一页勾选的 id 不再与屏幕对应；清空避免误操作。
  useEffect(() => {
    setSelected([]);
  }, [filters.params]);

  return (
    <AdminPage title="用户管理" description="管理注册用户的账号状态、角色与资源">
      <UserFilters
        keyword={filters.keyword}
        onKeywordChange={filters.setKeyword}
        role={filters.role}
        onRoleChange={filters.setRole}
        status={filters.status}
        onStatusChange={filters.setStatus}
        from={filters.from}
        to={filters.to}
        onDateRangeChange={({ from, to }) => {
          filters.setFrom(from);
          filters.setTo(to);
        }}
        segment={filters.segment}
        onSegmentChange={filters.setSegment}
        membership={filters.membership}
        onMembershipChange={filters.setMembership}
        appliedChips={filters.appliedChips}
        onApply={filters.applyFilters}
        onReset={filters.resetFilters}
      />

      <UserListSection
        data={filters.data}
        loading={filters.loading}
        error={filters.error}
        hasFilter={filters.hasFilter}
        view={view}
        onViewChange={setView}
        selected={selected}
        onSelectedChange={setSelected}
        canBatch={can('user.disable')}
        onBatch={(action, ids) => void actions.batchStatus(ids, action)}
        canBatchDelete={can('user.delete')}
        onBatchDelete={actions.openBatchDelete}
        batchBusy={actions.busy}
        selfId={me?.id ?? null}
        sort={filters.sort}
        onSortChange={(sort) => filters.setQuery({ sort })}
        canExport={can('data.export')}
        exporting={filters.exporting}
        onExport={() => void filters.exportUsers()}
        onRetry={filters.reload}
        onResetFilters={filters.resetFilters}
        onOpenUser={openUser}
        actionsFor={actions.rowActions}
        onPageChange={(page, pageSize) => {
          setSelected([]);
          filters.setPage(page, pageSize);
        }}
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

      {actions.logoutTarget && (
        <UserLogoutConfirm
          target={actions.logoutTarget}
          loading={actions.busy}
          onCancel={actions.closeLogout}
          onConfirm={() => void actions.confirmLogout()}
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

      {actions.batchDeleteTarget && (
        <BatchDeleteUsersDialog
          targets={actions.batchDeleteTarget}
          loading={actions.busy}
          onCancel={actions.closeBatchDelete}
          onConfirm={() => void actions.confirmBatchDelete()}
        />
      )}

      {actions.tempPassword && (
        <TempPasswordDialog
          password={actions.tempPassword.tempPassword}
          expiresAt={actions.tempPassword.expiresAt}
          onClose={actions.closeTempPassword}
        />
      )}
    </AdminPage>
  );
}
