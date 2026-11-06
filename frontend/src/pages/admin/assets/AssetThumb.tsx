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
  format,
}: {
  src: string;
  alt: string;
  className: string;
  /** 素材 MIME。视频不能用 <img> 解码，否则只会得到空白占位。 */
  format: string;
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

  if (format.startsWith('video/')) {
    return (
      <video
        data-asset-thumb="video"
        className={cn('bg-muted object-cover', className)}
        src={src}
        aria-label={alt}
        muted
        playsInline
        preload="metadata"
        // 只加载元数据时部分浏览器停在黑帧；轻推一个非零时间点以展示首帧。
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (video.duration > 0) video.currentTime = Math.min(0.1, video.duration / 2);
        }}
        onError={() => setFailed(true)}
      >
        您的浏览器不支持视频播放
      </video>
    );
  }

  return (
    <img
      data-asset-thumb="image"
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
