import { useState } from 'react';
import {
  ConfirmAlert,
  FormField,
  SelectField,
  StatusTag,
} from './components';
import { ROLE_OPTIONS } from './constants';
import type { AdminUserRole, AdminUserRow } from './types';

/**
 * 变更角色确认。
 *
 * 默认值必须等于当前角色：普通用户打开时不能预选「运营」，否则直接点
 * 确认就会提权。目标角色与当前角色相同时确认按钮保持禁用。
 */
export function UserRoleConfirm({
  target,
  loading,
  onCancel,
  onConfirm,
}: {
  target: AdminUserRow;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (role: AdminUserRole) => void;
}) {
  const [next, setNext] = useState<AdminUserRole>(target.role);

  return (
    <ConfirmAlert
      testId="admin-role-dialog"
      title="变更角色"
      icon={null}
      danger={false}
      description={
        <p>
          确定要变更 <strong>{target.email}</strong> 的角色吗？变更后立即生效。
        </p>
      }
      body={
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-radar-ink-500">当前角色</span>
            <StatusTag status={target.role} />
          </div>
          <FormField label="目标角色">
            <SelectField
              ariaLabel="目标角色"
              value={next}
              onChange={(value) => {
                // 白名单收窄：SelectField 的 value 是宽 string，反查选项表既校验又定型
                const next = ROLE_OPTIONS.find((option) => option.value === value)?.value;
                if (next) setNext(next);
              }}
              options={ROLE_OPTIONS}
            />
          </FormField>
        </div>
      }
      confirmText={loading ? '变更中…' : '确认变更'}
      loading={loading}
      confirmDisabled={next === target.role}
      onCancel={onCancel}
      onConfirm={() => onConfirm(next)}
    />
  );
}
