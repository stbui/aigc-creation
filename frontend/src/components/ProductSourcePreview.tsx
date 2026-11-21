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
 * 四个页面（翻译 / 精修 / 换色 / 旋转）共用这一份结构。
 *
 * 皮肤随组件走：此前由 `.pk-workspace.product-retouch-page .source-row`
 * 提供，现在直接写成工具类 —— 组件被谁渲染都成立，不再依赖页面样式表。
 */
const SOURCE_ROW =
  'source-row relative flex h-40 w-full items-center justify-center gap-6 min-[901px]:max-[1366px]:h-auto min-[901px]:max-[1366px]:flex-col min-[901px]:max-[1366px]:items-stretch min-[901px]:max-[1366px]:gap-2.5 max-[900px]:gap-3';

const PREVIEW_BTN =
  'box-border block h-40 w-40 flex-none cursor-zoom-in overflow-hidden rounded-[var(--radius-control)] border border-border bg-[var(--surface)] p-0 min-[901px]:max-[1366px]:aspect-square min-[901px]:max-[1366px]:h-auto min-[901px]:max-[1366px]:w-full max-[900px]:h-[min(160px,48vw)] max-[900px]:w-[min(160px,48vw)]';

const ACTION_BTN =
  'inline-flex h-10 w-[88px] min-w-[88px] flex-none cursor-pointer items-center justify-center whitespace-nowrap rounded-[var(--radius-control)] border-0 bg-[var(--color-border-soft)] px-3 text-sm leading-none text-[color:var(--text-body)] enabled:hover:bg-[var(--tool-surface-6)] disabled:cursor-wait disabled:opacity-65 min-[901px]:max-[1366px]:w-full min-[901px]:max-[1366px]:flex-none';

export function ProductSourceUploadPreview({ image, controls, alt }: SourceUploadPreviewProps) {
  return (
    <div
      className={`${SOURCE_ROW}${controls.uploading ? ' pointer-events-none opacity-[0.72]' : ''}`}
      aria-busy={controls.uploading}
    >
      <button
        type="button"
        className={PREVIEW_BTN}
        aria-label={`预览${alt}`}
        onClick={(event) => {
          event.stopPropagation();
          controls.preview(image);
        }}
      >
        {/* 160×160 上传位, 用缩略图; 右栏原图卡 (ProductSourceResult) 仍用原图 */}
        <img
          className="block size-full object-cover"
          src={assetThumbUrl(image.url, 320) ?? image.url}
          alt={alt}
          draggable={false}
        />
      </button>
      <div className="grid flex-none gap-2.5">
        <button
          type="button"
          className={ACTION_BTN}
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

/** 原图卡容器：铺满结果栏，内容居中 */
const RESULT_MAIN = 'grid w-full min-w-0 min-h-0 flex-1 border-0 rounded-none bg-transparent';

const RESULT_STATE =
  'flex w-full min-h-0 items-center justify-center max-[900px]:box-border max-[900px]:h-auto max-[900px]:px-[18px] max-[900px]:py-6';

/** 卡片按原图比例收敛高度：min(680px, 可用高度 - 48px) */
const RESULT_CARD =
  'relative box-border w-auto max-w-full h-[min(680px,calc(100%-48px))] max-h-[calc(100%-48px)] min-h-0 m-0 overflow-hidden rounded-[var(--radius-panel)] bg-[var(--page-bg)] aspect-[var(--result-card-aspect)] max-[900px]:h-auto max-[900px]:w-full max-[900px]:max-h-none';

interface ProductSourceResultProps {
  image: ToolAsset;
  alt: string;
  className?: string;
}

/** 上传后右栏的原图卡；生成成功后由 ToolShell 的结果区替换。 */
export function ProductSourceResult({ image, alt, className }: ProductSourceResultProps) {
  const [aspect, setAspect] = useState(1.6);

  return (
    <main className={`product-retouch-result ${RESULT_MAIN}${className ? ` ${className}` : ''}`}>
      <div className={RESULT_STATE} style={{ '--result-card-aspect': aspect } as CSSProperties}>
        <figure className={`product-retouch-result-card product-retouch-source-card ${RESULT_CARD}`}>
          <button
            type="button"
            className="block size-full cursor-zoom-in border-0 bg-transparent p-0"
            aria-label={`预览${alt}`}
            onClick={() => window.open(image.url, '_blank', 'noopener,noreferrer')}
          >
            <img
              className="block size-full object-contain object-center"
              src={image.url}
              alt={alt}
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (naturalWidth > 0 && naturalHeight > 0) {
                  setAspect(Number((naturalWidth / naturalHeight).toFixed(4)));
                }
              }}
            />
            <span className="absolute top-3 right-3 rounded-[var(--radius-card)] bg-[rgba(38,42,52,0.72)] px-[9px] py-1 text-xs leading-[17.5px] text-card">
              原图
            </span>
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
