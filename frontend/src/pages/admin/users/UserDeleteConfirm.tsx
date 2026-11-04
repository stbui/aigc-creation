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

/**
 * 删除用户的二次确认。
 *
 * 后端仍会逐字校验确认词；这里只保留最终的删除动作确认。
 */
export function UserDeleteConfirm({
  loading,
  onCancel,
  onConfirm,
}: {
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next && !loading) onCancel();
      }}
    >
      <AlertDialogContent
        data-testid="admin-delete-dialog"
        className="admin-portal w-[calc(100%-2rem)] max-w-[360px] gap-0 overflow-hidden p-0 sm:max-w-[360px]"
      >
        <AlertDialogHeader className="px-5 py-4 text-left">
          <AlertDialogTitle className="flex items-center gap-2 text-base text-destructive">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            删除
          </AlertDialogTitle>
          <AlertDialogDescription>确定要删除该用户吗？</AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="border-t border-border bg-muted/40 px-5 py-3">
          <AlertDialogCancel size="sm" disabled={loading} onClick={onCancel}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            size="sm"
            disabled={loading}
            onClick={(event) => {
              // 删除成功或失败后再由父级关闭，避免请求期间弹框提前消失。
              event.preventDefault();
              onConfirm();
            }}
          >
            {loading ? '删除中…' : '永久删除'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
