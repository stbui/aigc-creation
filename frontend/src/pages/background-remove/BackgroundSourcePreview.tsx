import { type CSSProperties, useState } from 'react';

import type { ToolAsset } from './components';

/**
 * 原图预览 —— 按图片真实宽高比撑开预览框。
 *
 * 初始按 16:10 占位, 图片加载完成后再用自然尺寸修正, 避免竖图在预览里
 * 被拉扁。`key` 由页面按 url 传入, 换图即重挂载并重新测量。
 */
export function BackgroundSourcePreview({ image }: { image: ToolAsset }) {
  const [aspect, setAspect] = useState(1.6);

  return (
    <div
      className="background-remove-preview background-remove-source-preview"
      style={{ '--source-aspect': aspect } as CSSProperties}
    >
      <img
        src={image.url}
        alt={`${image.name} 原图预览`}
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          if (naturalWidth > 0 && naturalHeight > 0) setAspect(naturalWidth / naturalHeight);
        }}
      />
    </div>
  );
}
