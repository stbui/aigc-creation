import type { ReactNode } from 'react';
import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';

/**
 * 响应式弹窗：移动端底部上滑，桌面居中弹出。
 *
 * 焦点锁定、Esc 关闭、遮罩点击和关闭后焦点归位由 Radix Dialog 负责，
 * 不在此处手写键盘与浮层逻辑。
 */
export function SheetModal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="radar-backdrop-enter fixed inset-0 z-50 bg-radar-ink-950/30 backdrop-blur-[1px]" />
        <DialogPrimitive.Content
          className="radar-sheet-enter admin-portal radar-scope fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] w-full flex-col rounded-t-[12px] rounded-b-none border border-radar-ink-200 bg-radar-surface outline-none sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[12px] sm:shadow-none"
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-radar-ink-100 px-5 py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-[15px] font-semibold text-radar-ink-950">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-0.5 text-pretty text-[12.5px] leading-5 text-radar-ink-400">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label="关闭"
              className="shrink-0 rounded-lg p-1.5 text-radar-ink-500 transition-colors hover:bg-radar-ink-100 hover:text-radar-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-radar-accent"
            >
              <XIcon className="size-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            {children}
          </div>

          {footer && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-radar-ink-100 bg-radar-surface-hover px-5 py-3">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
