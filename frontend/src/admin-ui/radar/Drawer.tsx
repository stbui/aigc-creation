import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

const DRAWER_WIDTH = { sm: 520, md: 640, lg: 760, xl: 1080 } as const;
export type DrawerSize = keyof typeof DRAWER_WIDTH;
export { DRAWER_WIDTH };

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
  description,
  size = 'md',
  width,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  size?: DrawerSize;
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
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
  const resolvedWidth = width ?? DRAWER_WIDTH[size];

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="radar-backdrop-enter absolute inset-0 bg-radar-ink-950/25 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside
        style={{ width: resolvedWidth, maxWidth: '100vw' }}
        className="radar-drawer-enter radar-drawer-shadow absolute right-0 top-0 flex h-full w-full flex-col border-l border-radar-ink-200 bg-radar-surface"
      >
        <div className="flex items-start justify-between gap-3 border-b border-radar-ink-100 px-5 py-3.5">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-radar-ink-950">{title}</div>
            {description && (
              <p className="mt-0.5 text-[12.5px] leading-5 text-radar-ink-400">{description}</p>
            )}
          </div>
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
