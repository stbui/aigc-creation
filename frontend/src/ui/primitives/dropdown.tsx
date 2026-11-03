import type { ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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
  /**
   * 条目自身的类名 —— 用于「当前选中项」这类需要给**整行**上样式的场合。
   *
   * ⚠️ 选中态不要只包一层 `<span>` 再上样式: 行内元素拿不到整行的背景宽度,
   * 表现为高亮只圈住几个字 (而非参考站那种整行胶囊)。@2026-11-03
   */
  className?: string;
  onClick?: () => void;
}

export interface DropdownProps {
  menu: {
    /** 菜单顶部的自定义信息区，不参与键盘菜单项导航。 */
    header?: ReactNode;
    items: DropdownItem[];
  };
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: 'bottomLeft' | 'bottomRight' | 'topLeft' | 'topRight';
  /** 是否锁定页面滚动。账户菜单这类大面板应保持页面可滚动。 */
  modal?: boolean;
  classNames?: { root?: string };
}

/** antd Dropdown 的兼容壳：menu.items → radix DropdownMenu。 */
export function Dropdown({
  menu,
  children,
  open,
  onOpenChange,
  placement = 'bottomLeft',
  modal = true,
  classNames,
}: DropdownProps) {
  const side = placement.startsWith('top') ? 'top' : 'bottom';
  const align = placement.endsWith('Right') ? 'end' : 'start';

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={modal}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        side={side}
        align={align}
        className={cn('ui-dropdown-content min-w-[180px]', classNames?.root)}
      >
        {menu.header}
        <DropdownMenuGroup>
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
                  item.className,
                )}
                onSelect={() => item.onClick?.()}
              >
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
