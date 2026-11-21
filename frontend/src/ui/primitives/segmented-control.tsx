import type { ReactNode } from 'react';

import { ToggleGroup, ToggleGroupItem } from '~/admin-ui/components/ui/toggle-group';
import { cn } from '../lib/cn';

export interface SegmentedOption {
  value: string;
  label: ReactNode;
}

export interface SegmentedControlProps {
  value: string;
  onChange: (value: string) => void;
  options: SegmentedOption[];
  /** 分组读屏名称；Radix ToggleGroup 输出 `role="group"` */
  ariaLabel: string;
  className?: string;
}

/**
 * C 端分段选择（互斥过滤条 / 密度切换）。
 *
 * 走 shadcn `ToggleGroup`：输出 `role="group"` + `aria-pressed`，读屏不会把它
 * 误播成页签，方向键在组内移动、`Tab` 只落在当前项。替代此前各页手写的
 * 「一排 `button` + `is-active` 类名」过滤条。
 *
 * 只在语义是「同一区域的互斥筛选」时使用；切换内容面板仍用 `Tabs`，
 * 跨页入口仍用 `<Link aria-current>`。
 */
export function SegmentedControl({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: SegmentedControlProps) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        // Radix 允许取消选中，分段控件必须始终有一项生效。
        if (next) onChange(next);
      }}
      aria-label={ariaLabel}
      spacing={0}
      variant="outline"
      size="sm"
      className={cn('h-8 rounded-md border border-border bg-card p-0.5', className)}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className={cn(
            'h-7 min-w-0 rounded-[6px] border-0 px-2.5 text-xs font-medium text-muted-foreground shadow-none',
            'hover:bg-muted hover:text-foreground',
            'data-[state=on]:bg-brand-bg data-[state=on]:text-brand',
          )}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
