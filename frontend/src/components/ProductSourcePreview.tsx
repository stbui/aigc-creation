import { useState, type CSSProperties } from 'react';

import type { ToolAsset, UploadPreviewControls } from './ToolShell';
import { assetThumbUrl } from '../lib/api';

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
        {/* 160×160 上传位, 用缩略图; 右栏原图卡 (ProductSourceResult) 仍用原图 */}
        <img src={assetThumbUrl(image.url, 320) ?? image.url} alt={alt} draggable={false} />
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

/**
 * 单图工具的上传态 render prop。
 *
 * 四个产品系工具页（翻译 / 精修 / 换色 / 旋转）此前各写一遍同样的 12 行
 * 「取第一张图，有图才渲染」样板，差异只有 `alt` 与右栏的 `className`。
 * 收成工厂后页面只声明「用什么文案」，改预览结构时不会漏掉某一页。
 *
 * 返回的仍是普通渲染回调，`ToolShell` 不必知道 preset 的存在。
 */
export function productSourceUploadPreview(alt: string) {
  return (uploads: ToolAsset[], controls: UploadPreviewControls) =>
    uploads[0] ? (
      <ProductSourceUploadPreview image={uploads[0]} controls={controls} alt={alt} />
    ) : null;
}

/** 同上，右栏原图卡的 render prop；`className` 供个别页追加样式。 */
export function productSourcePane(alt: string, className?: string) {
  return (images: ToolAsset[]) =>
    images[0] ? <ProductSourceResult image={images[0]} alt={alt} className={className} /> : null;
}
