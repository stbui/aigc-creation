import type { ReactNode } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '~/admin-ui/components/ui/sheet';

export interface DrawerProps {
  open: boolean;
  title?: ReactNode;
  children?: ReactNode;
  onClose?: () => void;
  side?: 'left' | 'right' | 'top' | 'bottom';
  width?: number | string;
  className?: string;
  bodyPadding?: number | string;
}

/** C 端抽屉：侧边方向映射到 shadcn Sheet。 */
export function Drawer({
  open,
  title,
  children,
  onClose,
  side = 'right',
  width,
  className,
  bodyPadding,
}: DrawerProps) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose?.()}>
      <SheetContent
        data-testid="ui-drawer"
        side={side}
        className={className}
        style={width !== undefined ? { width } : undefined}
      >
        <SheetHeader>
          <SheetTitle className={!title ? 'sr-only' : undefined}>{title ?? '抽屉'}</SheetTitle>
        </SheetHeader>
        <div
          className="ui-drawer-body"
          data-slot="drawer-body"
          style={bodyPadding !== undefined ? { padding: bodyPadding } : undefined}
        >
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
