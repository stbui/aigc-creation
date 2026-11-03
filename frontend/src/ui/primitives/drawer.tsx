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
  placement?: 'left' | 'right' | 'top' | 'bottom';
  width?: number | string;
  size?: number | string;
  className?: string;
  styles?: { body?: React.CSSProperties };
}

/** antd Drawer 的兼容壳，侧边方向映射到 shadcn Sheet。 */
export function Drawer({
  open,
  title,
  children,
  onClose,
  placement = 'right',
  width,
  size,
  className,
  styles,
}: DrawerProps) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose?.()}>
      <SheetContent
        data-testid="ui-drawer"
        side={placement}
        className={className}
        style={{ width: width ?? size }}
      >
        <SheetHeader>
          <SheetTitle className={!title ? 'sr-only' : undefined}>{title ?? '抽屉'}</SheetTitle>
        </SheetHeader>
        <div className="ui-drawer-body" style={styles?.body}>
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
