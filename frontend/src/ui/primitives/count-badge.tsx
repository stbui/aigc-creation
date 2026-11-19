import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface CountBadgeProps {
  count?: number;
  dot?: boolean;
  children?: ReactNode;
  className?: string;
}

/**
 * 图标上的未读角标。
 *
 * 与 shadcn `Badge`（标签）职责不同：这里只输出叠在子元素右上角的数字/圆点，
 * 不承担分类或状态文案，所以单独命名，避免两个同义 `Badge`。
 */
export function CountBadge({ count, dot, children, className }: CountBadgeProps) {
  const show = dot || (count !== undefined && count > 0);
  return (
    <span className={cn('relative inline-flex', className)}>
      {children}
      {show && (
        <span className="ui-badge-count" data-slot="badge-count" aria-hidden>
          {dot ? null : count && count > 99 ? '99+' : count}
        </span>
      )}
    </span>
  );
}
