import type { ReactNode } from 'react';
import { cn } from '~/admin-ui/lib/cn';

/**
 * 单选按钮组的一枚。
 *
 * `ActionButton` 不透传 `aria-pressed`，而字重 / 位置这两组按钮需要把当前
 * 选中态暴露给读屏与 e2e —— 用原生按钮并沿用同一套语义色。
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
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center justify-center rounded-md border px-3 text-sm font-medium shadow-xs transition-colors',
        'outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'disabled:cursor-not-allowed disabled:opacity-50',
        pressed
          ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
          : 'border-border bg-card text-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}
