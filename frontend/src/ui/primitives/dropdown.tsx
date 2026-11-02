import type { ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/admin-ui/components/ui/dropdown-menu';
import { cn } from '../lib/cn';

export interface DropdownItem {
  key: string;
  label?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  type?: 'divider';
  onClick?: () => void;
}

export interface DropdownProps {
  menu: { items: DropdownItem[] };
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: 'bottomLeft' | 'bottomRight' | 'topLeft' | 'topRight';
  classNames?: { root?: string };
}

/** antd Dropdown 的兼容壳：menu.items → radix DropdownMenu。 */
export function Dropdown({
  menu,
  children,
  open,
  onOpenChange,
  placement = 'bottomLeft',
  classNames,
}: DropdownProps) {
  const side = placement.startsWith('top') ? 'top' : 'bottom';
  const align = placement.endsWith('Right') ? 'end' : 'start';

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        side={side}
        align={align}
        className={cn('ui-dropdown-content min-w-[180px]', classNames?.root)}
      >
        {menu.items.map((item) =>
          item.type === 'divider' ? (
            <DropdownMenuSeparator key={item.key} />
          ) : (
            <DropdownMenuItem
              key={item.key}
              disabled={item.disabled}
              className={cn(
                'ui-dropdown-item',
                item.danger && 'text-danger-text focus:text-danger-text',
              )}
              onSelect={() => item.onClick?.()}
            >
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
