import { useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';

/**
 * 作品卡里的图片。
 *
 * - 加载中保留 shimmer 底、加载完成淡入，撤掉占位时不闪白；
 * - 加载失败可原地重试（签名 URL 过期 / 后端重启后无需刷新整页）；
 * - 状态按 **URL** 记而不是布尔值 —— 刷新列表会换签名地址，布尔值不会自己复位。
 *
 * 画布是固定方形的 (见 .my-work-image-button), 图片 contain 填满: 产出比例
 * 从 1:1 到 16:9 不等, 按各自比例排会让同一行的卡片高矮不齐。
 */
export function WorkImage({
  src,
  alt,
  priority,
  onOpen,
}: {
  src: string;
  alt: string;
  /** 首屏前两张: 不懒加载, 让作品页一进来就有图可看 */
  priority?: boolean;
  onOpen: () => void;
}) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const loaded = loadedSrc === src;
  const failed = failedSrc === src;

  // 缓存命中时 load 可能早于监听挂载, 会永远停在 shimmer 上
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) setLoadedSrc(src);
  }, [src, retryNonce]);

  const retry = () => {
    setFailedSrc(null);
    setLoadedSrc(null);
    setRetryNonce((n) => n + 1);
  };

  return (
    <button
      type="button"
      className={`my-work-image-button${loaded ? ' is-loaded' : ''}${failed ? ' is-failed' : ''}`}
      onClick={failed ? retry : onOpen}
      aria-label={failed ? '图片加载失败，点击重试' : `查看${alt}大图`}
      title={failed ? '加载失败，点击重试' : '点击查看大图'}
    >
      <img
        ref={imgRef}
        key={retryNonce}
        src={src}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        onLoad={() => setLoadedSrc(src)}
        onError={() => setFailedSrc(src)}
      />
      {failed && (
        <span className="my-work-image-failed">
          <ImageOff size={18} />
          <small>加载失败，点击重试</small>
        </span>
      )}
    </button>
  );
}
