import { ImageOff } from 'lucide-react';

import { imagePreview } from './utils';
import type { PromptImage } from './types';

/**
 * 提示词配图缩略图。
 *
 * `imagePreview` 在引用无法解析时返回 `undefined`（典型是 `storage://` 对象已
 * 被删除或存储后端不可用）。这种时候必须渲染占位，而不是把引用拼成
 * `${API_BASE}/storage://...` 发出去 —— 那种请求必然 404，浏览器只会给一张
 * 破图，运营看不出是「图没了」还是「网络慢」。
 */
export function PromptImagePreview({
  image,
  size,
  alt,
  className = 'h-full w-full object-cover',
}: {
  image: Pick<PromptImage, 'ref' | 'previewUrl'>;
  size: number;
  alt: string;
  className?: string;
}) {
  const src = imagePreview(image, size);

  if (!src) {
    return (
      <span
        role="img"
        aria-label={`${alt}（不可用）`}
        className="flex h-full w-full items-center justify-center bg-muted/40 text-muted-foreground"
      >
        <ImageOff className="size-4" aria-hidden />
      </span>
    );
  }

  return <img src={src} alt={alt} className={className} />;
}
