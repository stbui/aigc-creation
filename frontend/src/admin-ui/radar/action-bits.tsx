import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Button } from './Button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip';

/* 动作与说明件：动作按钮、图标按钮、色调徽标、悬停说明。 */

export function ActionButton({
  children,
  onClick,
  variant = 'default',
  size = 'sm',
  disabled = false,
  icon: Icon,
  className,
  type = 'button',
  form,
  ariaLabel,
  ariaPressed,
  ariaExpanded,
  asChild = false,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'xs' | 'sm' | 'md' | 'default';
  disabled?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
  type?: 'button' | 'submit';
  form?: string;
  ariaLabel?: string;
  ariaPressed?: boolean;
  ariaExpanded?: boolean;
  /** 把按钮外观交给子元素（如 `<Link>`）；导航必须保留链接语义 */
  asChild?: boolean;
}) {
  const s: 'sm' | 'md' | 'xs' = size === 'xs' ? 'sm' : size === 'default' ? 'md' : size;
  /*
   * asChild 时由子元素（如 `<Link>`）持有原生语义，`type` / `form` 只属于
   * `<button>`，不能透传过去。动作回调和可访问属性仍然保留。
   */
  const nativeProps = asChild ? {} : { type, form, disabled };
  /*
   * Radar 皮肤里 `secondary` 就是白底 + 细线的「带边界次级动作」，与
   * `outline` 在内容区看起来一致；保留页面既有的 `outline` 写法，
   * 统一落到 secondary，避免同一层级的按钮在灰底上变成透明底。
   */
  const v: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' =
    variant === 'outline' ? 'secondary' : variant;
  return (
    <Button
      {...nativeProps}
      variant={v}
      size={s}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-expanded={ariaExpanded}
      aria-disabled={asChild && disabled ? true : undefined}
      asChild={asChild}
      className={cn(asChild && disabled && 'pointer-events-none opacity-60', className)}
    >
      {asChild ? (
        children
      ) : (
        <>
          {Icon ? <Icon className="size-4" aria-hidden /> : null}
          {children}
        </>
      )}
    </Button>
  );
}

export function IconButton({
  icon: Icon,
  label,
  title,
  size = 'sm',
  disabled = false,
  onClick,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  title?: string;
  size?: 'xs' | 'sm' | 'md';
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const sizes = { xs: 'size-7', sm: 'size-8', md: 'size-9' } as const;
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      className={cn('text-radar-ink-400 hover:bg-radar-ink-100 hover:text-radar-ink-900', sizes[size], className)}
    >
      <Icon className="size-4" aria-hidden />
    </Button>
  );
}

export function ToneBadge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'success' | 'warn' | 'danger';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-radar-ink-100 text-radar-ink-600',
    brand: 'bg-radar-ink-100 text-radar-ink-700',
    success: 'bg-radar-deal-subtle text-radar-deal',
    warn: 'bg-radar-code-subtle text-radar-code',
    danger: 'bg-radar-alert-subtle text-radar-alert',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[12px] leading-4 font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function HelpTip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="inline-flex cursor-help items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-radar-accent/40"
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent
          sideOffset={6}
          className="admin-portal radar-scope max-w-[340px] rounded-[8px] border border-radar-ink-200 bg-radar-ink-950 px-3 py-2 text-[12px] leading-relaxed text-white [&_svg]:bg-radar-ink-950 [&_svg]:fill-radar-ink-950"
        >
          {tip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
