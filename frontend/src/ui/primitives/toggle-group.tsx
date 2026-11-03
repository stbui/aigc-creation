import type { ReactNode } from 'react';
import { buttonVariants } from '~/admin-ui/components/ui/button';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { cn } from '../lib/cn';

export interface ToggleGroupOption {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  title?: string;
}

export interface ToggleGroupProps {
  value?: string;
  onValueChange?: (value: string) => void;
  options: ToggleGroupOption[];
  'aria-label': string;
  className?: string;
  itemClassName?: string;
}

/**
 * shadcn ToggleGroup 的 C 端轻量封装。
 *
 * 用于素材库这类 2–7 项的单选过滤组，选中态由 Radix 的 `data-state="on"`
 * 表达，避免页面循环 Button 并手写 `is-active` 业务状态。
 */
export function ToggleGroup({
  value,
  onValueChange,
  options,
  'aria-label': ariaLabel,
  className,
  itemClassName,
}: ToggleGroupProps) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={onValueChange}
      aria-label={ariaLabel}
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.value}
          value={option.value}
          title={option.title}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), itemClassName)}
        >
          {option.icon}
          {option.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}
