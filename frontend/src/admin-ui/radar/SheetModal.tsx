import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * 弹窗：移动端底部上滑 sheet（rounded-t-xl），桌面居中 pop（参考 freebie-radar QuickBlockModal）。
 * - 点击遮罩关闭；内容区 stopPropagation 防穿透。
 * - Esc 关闭。
 */
export function SheetModal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-radar-ink-950/30 backdrop-blur-[1px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="radar-sheet-enter sm:radar-pop-enter panel max-h-[90vh] w-full max-w-md overflow-y-auto rounded-b-none rounded-t-[12px] p-5 sm:rounded-[12px]"
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[14.5px] font-semibold text-radar-ink-950">{title}</div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-radar-ink-500 transition-colors hover:bg-radar-ink-100"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {children}
        {footer && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">{footer}</div>
        )}
      </div>
    </div>
  );
}
