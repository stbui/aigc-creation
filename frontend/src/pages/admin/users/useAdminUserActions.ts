import { useRef, useState } from 'react';
import { useAdmin, useToast } from './hooks';
import { adminUsersApi } from './api';
import type { UserCardAction } from './UserCard';
import type { AdminUserRole, AdminUserRow } from './types';
import type { AdminPasswordReset } from '../../../types/api';

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
  const [logoutTarget, setLogoutTarget] = useState<AdminUserRow | null>(null);
  const [tempPassword, setTempPassword] = useState<AdminPasswordReset | null>(
    null,
  );
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

  const updateStatus = async (next: 'active' | 'disabled', reason?: string) => {
    if (!statusTarget) return;
    await run(async () => {
      await adminUsersApi.changeStatus(statusTarget.id, next, reason);
      setStatusTarget(null);
      reload();
      toast.success(next === 'disabled' ? '账号已禁用，登录凭证立即失效' : '账号已启用');
    }, '操作失败');
  };

  const updateRole = async (next: AdminUserRole, reason?: string) => {
    if (!roleTarget) return;
    await run(async () => {
      await adminUsersApi.changeRole(roleTarget.id, next, reason);
      setRoleTarget(null);
      reload();
      toast.success('角色已变更');
    }, '操作失败');
  };

  const confirmLogout = async () => {
    if (!logoutTarget) return;
    await run(async () => {
      await adminUsersApi.logoutAll(logoutTarget.id);
      setLogoutTarget(null);
      reload();
      toast.success('已强制下线，所有旧登录凭证立即失效');
    }, '强制下线失败');
  };

  /** 批量启停：后端逐条执行，这里按成功/失败数回显，不吞掉失败明细。 */
  const batchStatus = async (
    ids: string[],
    action: 'disable' | 'enable',
  ) => {
    await run(async () => {
      const summary = await adminUsersApi.batch(ids, action);
      reload();
      if (summary.failed > 0) {
        const first = summary.results.find((item) => !item.ok)?.message;
        toast.error(
          `批量${action === 'disable' ? '禁用' : '启用'}完成：成功 ${summary.succeeded} 条，失败 ${summary.failed} 条${first ? `（${first}）` : ''}`,
        );
      } else {
        toast.success(
          `批量${action === 'disable' ? '禁用' : '启用'}完成：${summary.succeeded} 条`,
        );
      }
    }, '批量操作失败');
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
      setTempPassword(result);
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
      can('user.disable') && mutable && !isSelf
        ? {
          key: 'logout',
          label: '强制下线',
          disabled: busy,
          onSelect: () => setLogoutTarget(row),
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
    logoutTarget,
    tempPassword,
    busy,
    rowActions,
    updateStatus,
    updateRole,
    confirmDelete,
    confirmLogout,
    resetPassword,
    batchStatus,
    closeStatus: () => setStatusTarget(null),
    closeRole: () => setRoleTarget(null),
    closeDelete: () => setDeleteTarget(null),
    closeLogout: () => setLogoutTarget(null),
    closeTempPassword: () => setTempPassword(null),
  };
}
