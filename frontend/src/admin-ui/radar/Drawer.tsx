import type { ReactNode } from 'react';
import { XIcon } from 'lucide-react';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '../components/ui/sheet';
import {
  OVERLAY_BACKDROP,
  OVERLAY_CLOSE,
  OVERLAY_DESC,
  OVERLAY_FOOTER,
  OVERLAY_HEADER,
  OVERLAY_SURFACE,
  OVERLAY_TITLE,
} from './overlayClasses';

export const DRAWER_WIDTH = { sm: 520, md: 640, lg: 760, xl: 1080 } as const;
export type DrawerSize = keyof typeof DRAWER_WIDTH;

/**
 * 右侧详情抽屉。
 *
 * 浮层行为交给 shadcn `Sheet`（同一个 Radix Dialog 底座）：焦点锁定、Esc、
 * 遮罩点击与关闭后的焦点归位都由组件库负责；视觉层只替换底色 / 描边 / 动画，
 * 尺寸档位与抽屉唯一的阴影留在 Radar 令牌里。
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
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        overlayClassName={OVERLAY_BACKDROP}
        data-testid="admin-drawer"
        style={{ width: resolvedWidth, maxWidth: '100vw' }}
        className={`radar-drawer-enter radar-drawer-shadow border-radar-ink-200 ${OVERLAY_SURFACE}`}
      >
        <div className={`${OVERLAY_HEADER} px-5 py-3.5`}>
          <div className="min-w-0">
            <SheetTitle className={OVERLAY_TITLE}>{title}</SheetTitle>
            {description && <SheetDescription className={OVERLAY_DESC}>{description}</SheetDescription>}
          </div>
          <SheetClose aria-label="关闭" className={OVERLAY_CLOSE}>
            <XIcon className="size-4" aria-hidden />
          </SheetClose>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>

        {footer && <div className={OVERLAY_FOOTER}>{footer}</div>}
      </SheetContent>
    </Sheet>
  );
}
