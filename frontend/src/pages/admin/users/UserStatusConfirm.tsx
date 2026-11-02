import { useState } from 'react';
import { ConfirmAction, FormField, TextField } from './components';
import type { AdminUserListResult } from '../../../types/api';

type Row = AdminUserListResult['items'][number];

/**
 * 禁用 / 启用账号的操作条。
 *
 * 禁用会切断在线凭证，原因随请求落审计；启用不具破坏性，原因可留空。
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
  onConfirm: (next: 'active' | 'disabled', reason: string) => void;
}) {
  const [reason, setReason] = useState('');
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
      extra={
        <FormField label="操作原因（建议填写）">
          <TextField
            ariaLabel="操作原因"
            placeholder="如：违规使用"
            value={reason}
            onChange={setReason}
            maxLength={200}
          />
        </FormField>
      }
      onCancel={onCancel}
      onConfirm={() => onConfirm(next, reason)}
    />
  );
}
