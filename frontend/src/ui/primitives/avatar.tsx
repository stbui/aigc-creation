import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface AvatarProps {
  size?: number;
  className?: string;
  children?: ReactNode;
  src?: string;
  alt?: string;
}

/** antd Avatar 的兼容壳（C 端只使用文字头像）。 */
export function Avatar({ size = 32, className, children, src, alt }: AvatarProps) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full', className)}
      style={{ width: size, height: size }}
    >
      {src ? <img src={src} alt={alt ?? ''} className="h-full w-full object-cover" /> : children}
    </span>
  );
}
