import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/admin-ui/primitives';
import type { AdminUserRow } from './types';

/**
 * 禁用 / 启用账号确认。
 *
 * 禁用会切断在线凭证；系统按操作上下文写入审计。
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
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !loading) onCancel();
      }}
    >
      <AlertDialogContent
        data-testid="admin-status-dialog"
        className="admin-portal w-[calc(100%-2rem)] max-w-[400px] gap-0 overflow-hidden p-0 sm:max-w-[400px]"
      >
        <AlertDialogHeader className="px-5 py-4 text-left">
          <AlertDialogTitle className="flex items-center gap-2 text-base">
            {disabling && <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />}
            {disabling ? '禁用账号' : '启用账号'}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-1.5">
              <p>
                确定要{disabling ? '禁用' : '启用'} <strong>{target.email}</strong> 吗？
              </p>
              <p>
                {disabling
                  ? '禁用后该用户将立即退出登录，无法继续使用账号。'
                  : '启用后该用户可以重新登录并使用账号。'}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="border-t border-border bg-muted/40 px-5 py-3">
          <AlertDialogCancel size="sm" disabled={loading} onClick={onCancel}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            variant={disabling ? 'destructive' : 'default'}
            size="sm"
            disabled={loading}
            onClick={(event) => {
              // 请求结束后再由父级关闭，避免加载期间弹框提前消失。
              event.preventDefault();
              onConfirm(next);
            }}
          >
            {loading ? '处理中…' : disabling ? '确认禁用' : '确认启用'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
