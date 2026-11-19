import { LogOut } from 'lucide-react';
import { ConfirmAlert } from './components';
import type { AdminUserRow } from './types';

/**
 * 强制下线确认。
 *
 * 与「禁用」不同：账号仍可正常登录，只是当前已签发的 token 立即失效。
 * 适用于怀疑会话泄露、或用户要求「把其他设备踢下线」。
 */
export function UserLogoutConfirm({
  target,
  loading,
  onCancel,
  onConfirm,
}: {
  target: AdminUserRow;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmAlert
      testId="admin-logout-dialog"
      title="强制下线"
      icon={LogOut}
      danger={false}
      description={
        <>
          <p>
            确定要让 <strong>{target.email}</strong> 强制下线吗？
          </p>
          <p>该账号当前所有设备的登录状态会立即失效，但用户仍可用原密码重新登录。</p>
        </>
      }
      confirmText={loading ? '处理中…' : '确认下线'}
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
