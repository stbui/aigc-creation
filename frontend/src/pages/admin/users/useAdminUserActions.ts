import { useRef, useState } from 'react';
import { useAdmin, useToast } from './hooks';
import { adminUsersApi } from './api';
import type { UserCardAction } from './UserCard';
import type { AdminUserRole, AdminUserRow } from './types';

interface Options {
  reload: () => void;
  onDeleted: () => void;
}

/**
 * 用户管理的高危写操作。
 *
 * 所有写请求共用一把互斥锁，防止双击或快捷键在第一次请求完成前重复提交。
 * 确认框目标单独保存，关闭时不会误清空其它业务状态。
 */
export function useAdminUserActions({ reload, onDeleted }: Options) {
  const toast = useToast();
  const { can, me } = useAdmin();
  const [statusTarget, setStatusTarget] = useState<AdminUserRow | null>(null);
  const [roleTarget, setRoleTarget] = useState<AdminUserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUserRow | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const run = async (task: () => Promise<void>, fallbackMessage: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await task();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : fallbackMessage);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const updateStatus = async (next: 'active' | 'disabled') => {
    if (!statusTarget) return;
    await run(async () => {
      await adminUsersApi.changeStatus(statusTarget.id, next);
      setStatusTarget(null);
      reload();
      toast.success(next === 'disabled' ? '账号已禁用，登录凭证立即失效' : '账号已启用');
    }, '操作失败');
  };

  const updateRole = async (next: AdminUserRole) => {
    if (!roleTarget) return;
    await run(async () => {
      await adminUsersApi.changeRole(roleTarget.id, next);
      setRoleTarget(null);
      reload();
      toast.success('角色已变更');
    }, '操作失败');
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await run(async () => {
      await adminUsersApi.remove(deleteTarget.id, false);
      setDeleteTarget(null);
      onDeleted();
      reload();
      toast.success('用户已注销，资金记录已匿名保留');
    }, '删除失败');
  };

  const resetPassword = async (target: AdminUserRow) => {
    await run(async () => {
      const result = await adminUsersApi.resetPassword(target.id);
      setTempPassword(result.tempPassword);
      reload();
    }, '重置密码失败');
  };

  const rowActions = (row: AdminUserRow): UserCardAction[] => {
    const mutable = row.status !== 'deleted';
    const isSelf = row.id === me?.id;
    const candidates: Array<UserCardAction | null> = [
      can('user.disable') && mutable && !isSelf
        ? {
          key: 'status',
          label: row.status === 'active' ? '禁用账号' : '启用账号',
          emphasis: row.status === 'disabled' ? 'primary' : undefined,
          disabled: busy,
          onSelect: () => setStatusTarget(row),
        }
        : null,
      can('user.write') && mutable && !isSelf
        ? {
          key: 'role',
          label: '变更角色',
          disabled: busy,
          onSelect: () => setRoleTarget(row),
        }
        : null,
      can('user.reset_password') && mutable
        ? {
          key: 'password',
          label: '重置密码',
          disabled: busy,
          onSelect: () => void resetPassword(row),
        }
        : null,
      can('user.delete') && mutable && !isSelf
        ? {
          key: 'delete',
          label: '删除用户',
          danger: true,
          disabled: busy,
          onSelect: () => setDeleteTarget(row),
        }
        : null,
    ];
    return candidates.filter((action): action is UserCardAction => action !== null);
  };

  return {
    statusTarget,
    roleTarget,
    deleteTarget,
    tempPassword,
    busy,
    rowActions,
    updateStatus,
    updateRole,
    confirmDelete,
    resetPassword,
    closeStatus: () => setStatusTarget(null),
    closeRole: () => setRoleTarget(null),
    closeDelete: () => setDeleteTarget(null),
    closeTempPassword: () => setTempPassword(null),
  };
}
