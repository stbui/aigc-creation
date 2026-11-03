import { useState } from 'react';
import { ConfirmAction, FormField, SelectField, StatusTag } from './components';
import type { AdminUserListResult } from '../../../types/api';

type Row = AdminUserListResult['items'][number];

/**
 * 变更角色的操作条。
 *
 * 默认值必须等于当前角色：管理员 / 财务账号打开时不能预选「运营」，
 * 否则直接点确认就把人降权了。
 */
export function UserRoleConfirm({
  target,
  loading,
  onCancel,
  onConfirm,
}: {
  target: Row;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (role: string) => void;
}) {
  const currentAssignable = target.role === 'user' ? 'operator' : target.role;
  const [next, setNext] = useState<string>(currentAssignable);

  return (
    <ConfirmAction
      open
      title="变更角色"
      confirmText="确认变更"
      loading={loading}
      confirmDisabled={next === target.role}
      description={
        <>
          <p>
            用户：<strong>{target.email}</strong>
          </p>
          <p className="mt-1 flex items-center gap-1.5">
            当前角色：<StatusTag status={target.role} />
          </p>
        </>
      }
      impact={[
        '变更立即生效，该用户的旧 token 下次请求即按新角色鉴权',
        '目标角色的权限点集合将整体生效',
        '写操作审计（含操作人）',
      ]}
      extra={
        <>
          <FormField label="目标角色">
            <SelectField
              ariaLabel="目标角色"
              value={next}
              onChange={(value) => {
                if (value) setNext(value);
              }}
              options={[
                { value: 'operator', label: '运营' },
                { value: 'finance', label: '财务' },
                { value: 'admin', label: '管理员' },
              ]}
            />
          </FormField>
        </>
      }
      onCancel={onCancel}
      onConfirm={() => onConfirm(next)}
    />
  );
}
