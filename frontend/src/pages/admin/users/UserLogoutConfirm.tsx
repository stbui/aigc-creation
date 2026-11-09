import { LogOut } from 'lucide-react';
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
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !loading) onCancel();
      }}
    >
      <AlertDialogContent
        data-testid="admin-logout-dialog"
        className="admin-portal w-[calc(100%-2rem)] max-w-[400px] gap-0 overflow-hidden p-0"
      >
        <AlertDialogHeader className="px-5 py-4 text-left">
          <AlertDialogTitle className="flex items-center gap-2 text-base">
            <LogOut className="size-4 shrink-0" aria-hidden />
            强制下线
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-1.5">
              <p>
                确定要让 <strong>{target.email}</strong> 强制下线吗？
              </p>
              <p>
                该账号当前所有设备的登录状态会立即失效，但用户仍可用原密码重新登录。
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="border-t border-border bg-muted/40 px-5 py-3">
          <AlertDialogCancel size="sm" disabled={loading} onClick={onCancel}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            size="sm"
            disabled={loading}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {loading ? '处理中…' : '确认下线'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
