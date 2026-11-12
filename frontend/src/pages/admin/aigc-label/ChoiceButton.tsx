import type { ReactNode } from 'react';
import { cn } from '~/admin-ui/lib/cn';
import { Toggle } from '~/admin-ui/primitives';

/**
 * 单选按钮组的一枚。
 *
 * 用 shadcn `Toggle` 而不是原生 `button`：选中态由 radix 输出成
 * `data-state=on` 与 `aria-pressed`，键盘操作、禁用态、聚焦环都由原子件负责，
 * 这里只声明「选中时填品牌色」这一层视觉。
 */
export function ChoiceButton({
  pressed,
  disabled,
  onClick,
  children,
}: {
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Toggle
      variant="outline"
      size="sm"
      pressed={pressed}
      onPressedChange={onClick}
      disabled={disabled}
      className={cn(
        'h-8 px-3 transition-colors disabled:cursor-not-allowed',
        'border-border bg-card text-foreground hover:bg-accent hover:text-foreground',
        'data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground',
        'data-[state=on]:hover:bg-primary/90 data-[state=on]:hover:text-primary-foreground',
      )}
    >
      {children}
    </Toggle>
  );
}
