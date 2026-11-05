import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from './utils';

/**
 * 缩略图。加载失败时保留稳定占位，避免破图图标破坏网格节奏。
 */
export function AssetThumb({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (failed) {
    return (
      <span
        className={cn(
          'flex items-center justify-center bg-muted text-muted-foreground',
          className,
        )}
        role="img"
        aria-label={`${alt}，缩略图加载失败`}
      >
        <ImageOff className="size-4" aria-hidden />
      </span>
    );
  }
  return (
    <img
      className={cn('bg-muted object-cover', className)}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
