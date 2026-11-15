import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * 右侧滑出详情抽屉（参考 freebie-radar ItemDetailDrawer）。
 * - 遮罩淡入 + 抽屉右滑入场（radar-drawer-enter）。
 * - Esc 关闭；点击遮罩关闭；内容区 stopPropagation 防穿透。
 * - 仅渲染在固定层（z-50），覆盖在后台外壳之上。
 */
export function Drawer({
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
    <div className="fixed inset-0 z-50">
      <div
        className="radar-backdrop-enter absolute inset-0 bg-radar-ink-950/25 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside className="radar-drawer-enter radar-drawer-shadow absolute right-0 top-0 flex h-full w-full flex-col border-l border-radar-ink-200 bg-radar-surface sm:max-w-[500px]">
        <div className="flex items-center justify-between border-b border-radar-ink-100 px-5 py-3.5">
          <div className="text-[12px] text-radar-ink-500">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-radar-ink-500 transition-colors hover:bg-radar-ink-100 hover:text-radar-ink-900"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && (
          <div className="border-t border-radar-ink-100 bg-radar-surface-hover px-5 py-3.5">
            {footer}
          </div>
        )}
      </aside>
    </div>
  );
}
