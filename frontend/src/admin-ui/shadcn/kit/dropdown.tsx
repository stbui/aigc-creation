import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui';

/**
 * 下拉菜单（shadcn 版），与 BoardUI 的 `Dropdown*` 同签名。
 *
 * 后台只有两处下拉：用户列表的「更多」和侧栏底部的用户菜单。它们原先直连
 * vendor，导致整站换观感时这两处留在旧样式里 —— 现在统一走这一层。
 *
 * 与 BoardUI 版的差别只在实现：开合、键盘导航、`aria-haspopup` 与焦点归还
 * 由 radix 负责。`placement` 保留 BoardUI 的 `"bottom end"` 写法，
 * 内部拆成 radix 的 `side` / `align`，调用点不用改。
 */

/** BoardUI 的 `placement`：`"<side> <align>"`，如 `"bottom end"` */
type Placement = 'bottom end' | 'bottom start' | 'top end' | 'top start';

function parsePlacement(placement: Placement | undefined) {
  if (!placement) return { side: 'bottom' as const, align: 'start' as const };
  const [side, align] = placement.split(' ');
  return {
    side: side === 'top' ? ('top' as const) : ('bottom' as const),
    align: align === 'end' ? ('end' as const) : ('start' as const),
  };
}

export function Dropdown({
  isOpen,
  onOpenChange,
  children,
}: {
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu open={isOpen} onOpenChange={onOpenChange}>
      {children}
    </DropdownMenu>
  );
}

/**
 * 触发器。
 *
 * 自带 `<button type="button">`（与 BoardUI 版一致），因此调用点传的是
 * className + 内容，而不是自己再包一层按钮。
 */
export function DropdownTrigger({
  className,
  children,
  ...props
}: ComponentProps<'button'> & { children: ReactNode }) {
  return (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md outline-none',
          'focus-visible:ring-[3px] focus-visible:ring-ring/50',
          className,
        )}
        {...props}
      >
        {children}
      </button>
    </DropdownMenuTrigger>
  );
}

export function DropdownPopover({
  className,
  placement,
  children,
  'aria-label': ariaLabel,
}: {
  className?: string;
  /** @deprecated 保留入参以兼容旧调用；默认 `"bottom start"` */
  placement?: Placement;
  'aria-label'?: string;
  children: ReactNode;
}) {
  const { side, align } = parsePlacement(placement);
  return (
    <DropdownMenuContent
      side={side}
      align={align}
      sideOffset={6}
      /*
       * radix 默认用触发器文案当菜单的无障碍名（`aria-labelledby`）。
       * 触发器写着「更多」、菜单里是「删除用户 / 重置密码」，读屏用户只听到
       * 「更多 菜单」无法判断点开的是什么。传了 `aria-label` 就一并清掉
       * `aria-labelledby`（显式传 undefined 才覆盖 radix 的默认值）。
       */
      {...(ariaLabel ? { 'aria-label': ariaLabel, 'aria-labelledby': undefined } : {})}
      className={cn('min-w-40', className)}
    >
      {children}
    </DropdownMenuContent>
  );
}

export function DropdownGroup({
  label,
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenuGroup className={className}>
      {label && (
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{label}</div>
      )}
      {children}
    </DropdownMenuGroup>
  );
}

export function DropdownItem({
  selected,
  onSelect,
  className,
  children,
}: {
  /** @deprecated 选中态改由调用方在内容里表达（图标 / 勾选） */
  selected?: boolean;
  onSelect?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenuItem
      data-selected={selected || undefined}
      className={cn('cursor-pointer text-[13px]', className)}
      onSelect={() => onSelect?.()}
    >
      {children}
    </DropdownMenuItem>
  );
}

export function DropdownDivider({ className }: { className?: string }) {
  return <DropdownMenuSeparator className={cn('-mx-1 my-1', className)} />;
}
