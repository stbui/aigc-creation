import type { ButtonHTMLAttributes } from 'react';
import { Slot } from 'radix-ui';
import { cn } from '../lib/cn';

export type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'outline' | 'destructive' | 'link';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'icon';

const BASE_CLASS =
  'inline-flex items-center justify-center gap-1.5 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-radar-accent disabled:cursor-not-allowed disabled:opacity-60';

/**
 * 高度写死而非靠 padding 撑开：实心按钮没有 1px 描边，靠 `py` 会比其他
 * 变体矮 2px（30 / 32 混排）。行内 `sm` = 32px 与筛选控件同高，
 * `xs` = 24px 只用于卡片/抽屉等非密集区域。
 */
const SIZE_CLASS: Record<ButtonSize, string> = {
  xs: 'h-6 rounded-[8px] px-2.5 text-[12px]',
  sm: 'h-8 rounded-[8px] px-3 text-[12.5px]',
  md: 'h-9 rounded-[8px] px-3.5 text-[13px]',
  icon: 'rounded-[8px] p-0 size-8',
};

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: 'bg-radar-brand text-white hover:bg-radar-brand-hover',
  secondary:
    'border border-radar-ink-200 bg-radar-surface text-radar-ink-700 hover:bg-radar-ink-100',
  outline:
    'border border-radar-ink-200 bg-transparent text-radar-ink-700 hover:bg-radar-ink-100',
  ghost: 'text-radar-ink-600 hover:bg-radar-ink-100',
  destructive: 'bg-radar-alert text-white hover:bg-radar-alert/90',
  link: 'text-radar-brand underline-offset-2 hover:underline',
};

/**
 * 按钮类名（唯一来源）。
 *
 * 需要把按钮外观套到非 `<button>` 元素上时用它 —— 尤其 Radix 的
 * `Dialog.Close` / `AlertDialog.Action`：这些原语需要自己持有 ref 才能完成
 * 焦点归位与关闭，套一层 Slot 会把 ref 丢掉。
 */
export function buttonClass({
  variant = 'default',
  size = 'md',
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(BASE_CLASS, SIZE_CLASS[size], VARIANT_CLASS[variant], className);
}

/**
 * 中性风格按钮。
 * - default：近墨黑实心（radar-brand），区别于产品品牌紫实心按钮。
 * - secondary：白底 + 细线边框；outline：透明底 + 细线边框；ghost：无底色悬停；destructive：告警红；link：文字链接。
 * - asChild：经 Slot 把样式套到子元素（如 `<Link>`），用于「看起来像按钮的链接」。
 * 圆角固定 8px（绕过后台 chunk 的 --radius 重映射，保证与 freebie-radar 一致）。
 */
export function Button({
  variant = 'default',
  size = 'md',
  className,
  asChild = false,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp className={buttonClass({ variant, size, className })} {...rest} />;
}
