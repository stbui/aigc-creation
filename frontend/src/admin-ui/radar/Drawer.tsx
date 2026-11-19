import type { ReactNode } from 'react';
import { XIcon } from 'lucide-react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import { cn } from '../lib/cn';

export const DRAWER_WIDTH = { sm: 520, md: 640, lg: 760, xl: 1080 } as const;
export type DrawerSize = keyof typeof DRAWER_WIDTH;

/**
 * 右侧详情抽屉。
 *
 * 浮层行为交给 Radix Dialog：焦点锁定、Esc、遮罩点击与关闭后的焦点归位
 * 都由组件库负责；视觉层使用 Radar 令牌、尺寸档位与唯一的抽屉阴影。
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
  title: ReactNode;
  description?: ReactNode;
  size?: DrawerSize;
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const resolvedWidth = width ?? DRAWER_WIDTH[size];

  return (
    <SheetPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetPrimitive.Portal>
        <SheetPrimitive.Overlay className="radar-backdrop-enter fixed inset-0 z-50 bg-radar-ink-950/25 backdrop-blur-[1px]" />
        <SheetPrimitive.Content
          data-testid="admin-drawer"
          data-slot="sheet-content"
          style={{ width: resolvedWidth, maxWidth: '100vw' }}
          className="radar-drawer-enter radar-drawer-shadow admin-portal radar-scope fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col border-l border-radar-ink-200 bg-radar-surface outline-none"
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-radar-ink-100 px-5 py-3.5">
            <div className="min-w-0">
              <SheetPrimitive.Title className="truncate text-[15px] font-semibold text-radar-ink-950">
                {title}
              </SheetPrimitive.Title>
              {description && (
                <SheetPrimitive.Description className="mt-0.5 text-pretty text-[12.5px] leading-5 text-radar-ink-400">
                  {description}
                </SheetPrimitive.Description>
              )}
            </div>
            <SheetPrimitive.Close
              aria-label="关闭"
              className="shrink-0 rounded-lg p-1.5 text-radar-ink-500 transition-colors hover:bg-radar-ink-100 hover:text-radar-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-radar-accent"
            >
              <XIcon className="size-4" aria-hidden />
            </SheetPrimitive.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
            {children}
          </div>

          {footer && (
            <div
              className={cn(
                'shrink-0 border-t border-radar-ink-100 bg-radar-surface-hover px-5 py-3.5',
                'flex flex-wrap items-center justify-end gap-2',
              )}
            >
              {footer}
            </div>
          )}
        </SheetPrimitive.Content>
      </SheetPrimitive.Portal>
    </SheetPrimitive.Root>
  );
}
