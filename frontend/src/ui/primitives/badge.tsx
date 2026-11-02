import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface BadgeProps {
  count?: number;
  dot?: boolean;
  children?: ReactNode;
  className?: string;
  color?: string;
  size?: string;
  offset?: [number, number];
}

/** antd Badge 的兼容壳：C 端只使用数字角标。 */
export function Badge({ count, dot, children, className }: BadgeProps) {
  const show = dot || (count !== undefined && count > 0);
  return (
    <span className={cn('relative inline-flex', className)}>
      {children}
      {show && (
        <span className="ui-badge-count" aria-hidden>
          {dot ? null : count && count > 99 ? '99+' : count}
        </span>
      )}
    </span>
  );
}
