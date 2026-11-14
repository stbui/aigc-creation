import { AlertTriangle, Trash2 } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
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
 * 用户注销（删除）确认的统一壳 —— 单个删除与批量删除共用。
 *
 * 两个调用方此前各手写一份 `AlertDialog` 骨架（标题图标、影响面滚动区、
 * footer 按钮、加载锁、矮视口限高），改一处漏一处就会出现「同一类高危动作
 * 两种确认形态」。放在 `components/admin` 而不是任一页面目录：单个删除住在
 * `pages/admin/users`，批量删除还要被积分账本页复用，页面目录会造成反向依赖。
 *
 * 这里只固定交互契约，不碰业务口径：
 * - `testId` 由调用方给，e2e 的 `admin-delete-dialog` / `admin-batch-delete-dialog`
 *   钩子不能改名；
 * - `loading` 期间不响应遮罩/ESC 关闭，确认按钮也不自动收起弹框 —— 请求结束
 *   后由父级清空 target 才关闭，避免加载态闪退；
 * - `confirmDisabled` 交给调用方（影响面未加载 / 超过单次上限）。
 */
export function DeleteUsersConfirmDialog({
  testId,
  title,
  description,
  children,
  confirmText,
  loading = false,
  confirmDisabled = false,
  onCancel,
  onConfirm,
}: {
  testId: string;
  title: ReactNode;
  /** `AlertDialogDescription` 用 asChild，必须是单个元素 */
  description: ReactElement;
  /** 影响面区域：由调用方各自组装，壳只负责限高与滚动 */
  children: ReactNode;
  confirmText: string;
  loading?: boolean;
  confirmDisabled?: boolean;
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
        data-testid={testId}
        className="admin-portal max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-[400px] gap-0 overflow-hidden p-0"
      >
        <AlertDialogHeader className="px-5 py-4 text-left">
          <AlertDialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 shrink-0 text-danger-text" aria-hidden />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="min-h-0 overflow-y-auto border-y border-border bg-muted/30 px-5 py-3 text-xs leading-5">
          {children}
        </div>

        <AlertDialogFooter className="bg-muted/40 px-5 py-3">
          <AlertDialogCancel size="sm" disabled={loading} onClick={onCancel}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            size="sm"
            disabled={loading || confirmDisabled}
            onClick={(event) => {
              // 请求结束后再由父级关闭，避免加载期间弹框提前消失。
              event.preventDefault();
              onConfirm();
            }}
          >
            <Trash2 className="size-3.5" aria-hidden />
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
