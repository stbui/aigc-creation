import { AlertTriangle, Power } from 'lucide-react';
import { ConfirmAlert } from './components';
import type { AdminUserRow } from './types';

/**
 * 禁用 / 启用账号确认。
 *
 * 禁用会切断在线凭证。
 */
export function UserStatusConfirm({
  target,
  loading,
  onCancel,
  onConfirm,
}: {
  target: AdminUserRow;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (next: 'active' | 'disabled') => void;
}) {
  const next: 'active' | 'disabled' = target.status === 'active' ? 'disabled' : 'active';
  const disabling = next === 'disabled';

  return (
    <ConfirmAlert
      testId="admin-status-dialog"
      title={disabling ? '禁用账号' : '启用账号'}
      icon={disabling ? AlertTriangle : Power}
      danger={disabling}
      description={
        <>
          <p>
            确定要{disabling ? '禁用' : '启用'} <strong>{target.email}</strong> 吗？
          </p>
          <p>
            {disabling
              ? '禁用后该用户将立即退出登录，无法继续使用账号。'
              : '启用后该用户可以重新登录并使用账号。'}
          </p>
        </>
      }
      confirmText={loading ? '处理中…' : disabling ? '确认禁用' : '确认启用'}
      loading={loading}
      onCancel={onCancel}
      onConfirm={() => onConfirm(next)}
    />
  );
}
