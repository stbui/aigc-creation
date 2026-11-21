import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/** 通用小徽章：圆角药丸 + 浅底 + 中深文字。 */
export function RadarBadge({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[12px] leading-4 font-medium',
        className,
      )}
    >
      {children}
    </span>
  );
}
