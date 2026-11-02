import type { ReactNode } from 'react';
import {
  Popover as ShadcnPopover,
  PopoverContent,
  PopoverTrigger,
} from '~/admin-ui/components/ui/popover';
import { cn } from '../lib/cn';

export interface PopoverProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  content?: ReactNode;
  children: ReactNode;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  trigger?: 'click' | 'hover';
  className?: string;
  overlayClassName?: string;
}

/** antd Popover 的兼容壳（C 端目前只使用 click 触发）。 */
export function Popover({
  open,
  onOpenChange,
  content,
  children,
  placement = 'bottom',
  className,
  overlayClassName,
}: PopoverProps) {
  return (
    <ShadcnPopover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side={placement} className={cn('w-auto p-0', className, overlayClassName)}>
        {content}
      </PopoverContent>
    </ShadcnPopover>
  );
}
