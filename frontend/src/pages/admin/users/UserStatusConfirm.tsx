import { ConfirmAction } from '~/admin-ui/primitives';
import type { AdminUserListResult } from '../../../types/api';

type Row = AdminUserListResult['items'][number];

/**
 * 禁用 / 启用账号的操作条。
 *
 * 禁用会切断在线凭证；系统按操作上下文写入审计。
 */
export function UserStatusConfirm({
  target,
  loading,
  onCancel,
  onConfirm,
}: {
  target: Row;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (next: 'active' | 'disabled') => void;
}) {
  const next: 'active' | 'disabled' = target.status === 'active' ? 'disabled' : 'active';

  return (
    <ConfirmAction
      open
      title={next === 'disabled' ? '禁用账号' : '启用账号'}
      confirmText={next === 'disabled' ? '确认禁用' : '确认启用'}
      danger={next === 'disabled'}
      loading={loading}
      description={
        <>
          <p>
            用户：<strong>{target.email}</strong>
          </p>
          {next === 'disabled' && (
            <p className="mt-1 text-danger-text">
              禁用后该用户的登录凭证立即失效，无法再登录或调用接口。
            </p>
          )}
        </>
      }
      impact={
        next === 'disabled'
          ? ['该账号现有登录凭证立即失效', '已发布作品与历史订单不受影响', '写操作审计（含操作人）']
          : ['该账号恢复登录能力', '写操作审计（含操作人）']
      }
      onCancel={onCancel}
      onConfirm={() => onConfirm(next)}
    />
  );
}
