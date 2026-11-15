import type { ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../lib/cn';

type Variant = 'default' | 'secondary' | 'ghost' | 'outline' | 'danger';
type Size = 'xs' | 'sm' | 'md';

/**
 * 中性风格按钮。
 * - default：近墨黑实心（radar-brand），区别于产品品牌紫实心按钮。
 * - secondary：白底 + 细线边框；outline：透明底 + 细线边框；ghost：无底色悬停；danger：告警红。
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
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot : 'button';
  const base =
    'inline-flex items-center justify-center gap-1.5 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-radar-accent disabled:cursor-not-allowed disabled:opacity-60';
  const sizes: Record<Size, string> = {
    xs: 'rounded-[8px] px-2.5 py-1 text-[12px]',
    sm: 'rounded-[8px] px-3 py-1.5 text-[12.5px]',
    md: 'rounded-[8px] px-3.5 py-2 text-[13px]',
  };
  const variants: Record<Variant, string> = {
    default: 'bg-radar-brand text-white hover:bg-radar-brand-hover',
    secondary:
      'border border-radar-ink-200 bg-radar-surface text-radar-ink-700 hover:bg-radar-ink-100',
    outline:
      'border border-radar-ink-200 bg-transparent text-radar-ink-700 hover:bg-radar-ink-100',
    ghost: 'text-radar-ink-600 hover:bg-radar-ink-100',
    danger: 'bg-radar-alert text-white hover:bg-red-700',
  };
  return <Comp className={cn(base, sizes[size], variants[variant], className)} {...rest} />;
}
