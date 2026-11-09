import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  FormField,
  SelectField,
  StatusTag,
  TextAreaField,
} from '~/admin-ui/primitives';
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
  onConfirm: (role: AdminUserRole, reason?: string) => void;
}) {
  const [next, setNext] = useState<AdminUserRole>(target.role);
  const [reason, setReason] = useState('');

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !loading) onCancel();
      }}
    >
      <AlertDialogContent
        data-testid="admin-role-dialog"
        className="admin-portal w-[calc(100%-2rem)] max-w-[400px] gap-0 overflow-hidden p-0"
      >
        <AlertDialogHeader className="px-5 py-4 text-left">
          <AlertDialogTitle className="text-base">变更角色</AlertDialogTitle>
          <AlertDialogDescription>
            确定要变更 <strong>{target.email}</strong> 的角色吗？变更后立即生效。
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-4 border-y border-border bg-muted/30 px-5 py-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">当前角色</span>
            <StatusTag status={target.role} />
          </div>
          <FormField label="目标角色">
            <SelectField
              ariaLabel="目标角色"
              value={next}
              onChange={(value) => {
                if (value) setNext(value as AdminUserRole);
              }}
              options={ROLE_OPTIONS}
            />
          </FormField>
          <FormField label="操作原因（可选）">
            <TextAreaField
              ariaLabel="操作原因"
              value={reason}
              onChange={setReason}
              placeholder="例如：岗位调整、职责变更"
              rows={2}
              maxLength={500}
            />
          </FormField>
        </div>

        <AlertDialogFooter className="bg-muted/40 px-5 py-3">
          <AlertDialogCancel size="sm" disabled={loading} onClick={onCancel}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            size="sm"
            disabled={loading || next === target.role}
            onClick={(event) => {
              // 请求结束后再由父级关闭，避免加载期间弹框提前消失。
              event.preventDefault();
              onConfirm(next, reason.trim() || undefined);
            }}
          >
            {loading ? '变更中…' : '确认变更'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
