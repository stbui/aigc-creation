import { useState, type CSSProperties } from 'react';

import type { ToolAsset, UploadPreviewControls } from './ToolShell';

interface SourceUploadPreviewProps {
  image: ToolAsset;
  controls: UploadPreviewControls;
  alt: string;
}

/**
 * 产品系工具共用的上传态。
 *
 * 参考站上传后不再保留虚线拖拽框，而是 160×160 缩略图 + 重新上传按钮；
 * 四个页面（翻译 / 精修 / 换色 / 旋转）共用这一份结构，尺寸由
 * `.pk-workspace.product-retouch-page` 下的样式收口。
 */
export function ProductSourceUploadPreview({ image, controls, alt }: SourceUploadPreviewProps) {
  return (
    <div className={`source-row${controls.uploading ? ' processing' : ''}`} aria-busy={controls.uploading}>
      <button
        type="button"
        className="product-retouch-source-preview"
        aria-label={`预览${alt}`}
        onClick={(event) => {
          event.stopPropagation();
          controls.preview(image);
        }}
      >
        <img src={image.url} alt={alt} draggable={false} />
      </button>
      <div>
        <button
          type="button"
          className="soft"
          disabled={controls.uploading}
          onClick={(event) => {
            event.stopPropagation();
            controls.open();
          }}
        >
          重新上传
        </button>
      </div>
    </div>
  );
}

interface ProductSourceResultProps {
  image: ToolAsset;
  alt: string;
  className?: string;
}

/** 上传后右栏的原图卡；生成成功后由 ToolShell 的结果区替换。 */
export function ProductSourceResult({ image, alt, className }: ProductSourceResultProps) {
  const [aspect, setAspect] = useState(1.6);

  return (
    <main className={`product-retouch-result${className ? ` ${className}` : ''}`}>
      <div
        className="product-retouch-result-state"
        style={{ '--result-card-aspect': aspect } as CSSProperties}
      >
        <figure className="product-retouch-result-card product-retouch-source-card">
          <button
            type="button"
            className="product-retouch-result-preview"
            aria-label={`预览${alt}`}
            onClick={() => window.open(image.url, '_blank', 'noopener,noreferrer')}
          >
            <img
              src={image.url}
              alt={alt}
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (naturalWidth > 0 && naturalHeight > 0) {
                  setAspect(Number((naturalWidth / naturalHeight).toFixed(4)));
                }
              }}
            />
            <span className="product-retouch-result-mode">原图</span>
          </button>
        </figure>
      </div>
    </main>
  );
}
