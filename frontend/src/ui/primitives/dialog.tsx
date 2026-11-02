import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/admin-ui/components/ui/dialog';
import { Button } from '~/admin-ui/components/ui/button';
import { cn } from '../lib/cn';

interface UiDialogProps {
  open: boolean;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  confirmLoading?: boolean;
  width?: number;
  onConfirm?: () => void;
  onCancel: () => void;
  /** info / success / error 这类纯告知弹窗只有一个按钮 */
  hideCancel?: boolean;
}

/**
 * 通用确认/表单弹窗。
 *
 * 替代 antd Modal 的常用形态。`children` 为空时是确认框；有内容时是普通弹窗，
 * 内容区宽度由 `width` 控制，视觉仍由 C 端现有 CSS 变量接管。
 */
export function UiDialog({
  open,
  title,
  description,
  children,
  confirmText,
  cancelText,
  danger,
  confirmLoading,
  width = 480,
  onConfirm,
  onCancel,
  hideCancel,
}: UiDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        data-testid="ui-app-dialog"
        className={cn('gap-4 p-6', children ? 'sm:max-w-[720px]' : 'sm:max-w-[480px]')}
        style={{ maxWidth: width }}
        aria-describedby={description ? undefined : undefined}
        showCloseButton={false}
      >
        {(title || description) && (
          <DialogHeader>
            {title && <DialogTitle className="text-base">{title}</DialogTitle>}
            {description && (
              <DialogDescription className="mt-1.5 text-sm leading-6">
                {description}
              </DialogDescription>
            )}
          </DialogHeader>
        )}
        {children}
        {(onConfirm || cancelText) && (
          <DialogFooter>
            {!hideCancel && (
              <Button variant="secondary" onClick={onCancel}>
                {cancelText ?? '取消'}
              </Button>
            )}
            {onConfirm && (
              <Button variant={danger ? 'destructive' : 'default'} disabled={confirmLoading} onClick={onConfirm}>
                {confirmText ?? '确定'}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
