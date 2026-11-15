import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

/**
 * 中性风格面板：白底 + 1px 细线 + 8px 圆角（零阴影）。
 * 对应 freebie-radar 的 `.panel` 工具类。
 */
export function Panel({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('panel', className)} {...rest}>
      {children}
    </div>
  );
}
