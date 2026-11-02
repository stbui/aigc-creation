import type { RefObject } from 'react';
import { ImagePlus, X } from 'lucide-react';

import { SUPPORTED_IMAGE_ACCEPT } from './constants';
import type { ToolAsset } from './components';
import { assetThumbUrl } from './api';
import { Spin } from '../../ui';

/**
 * 模板图卡片：上传 / 拖拽 / 素材库 / 手机上传与重新框选。
 *
 * 上传、框选与清空动作由页面提供；这里只负责展示与事件转发。
 */
export function ProductSkuTemplateCard({
  template,
  uploading,
  templateInputRef,
  onUpload,
  onOpenLibrary,
  onOpenMobile,
  onEditRegions,
  onPreview,
  onRemove,
}: {
  template: ToolAsset | null;
  uploading: boolean;
  templateInputRef: RefObject<HTMLInputElement | null>;
  onUpload: (files: FileList | File[]) => void;
  onOpenLibrary: () => void;
  onOpenMobile: () => void;
  onEditRegions: () => void;
  onPreview: (url: string) => void;
  onRemove: () => void;
}) {
  return (
    <section className="product-sku-card product-sku-template-card">
      <div className="product-sku-card-heading">
        <div className="product-sku-card-heading-top">
          <h2>SKU模板图</h2>
          <div className="product-sku-card-heading-actions">
            <button type="button" className="workspace-material-library-trigger" onClick={onOpenLibrary}>
              从素材库导入
            </button>
            <button type="button" className="mobile-upload-trigger mobile-upload-qr-trigger" onClick={onOpenMobile}>
              手机上传
            </button>
          </div>
        </div>
        <p className="product-sku-card-heading-copy">
          选一张结构最完整的成品图作为模板，框选要跟随SKU变动的区域，最多支持3个SKU变体区域
        </p>
      </div>

      <input
        ref={templateInputRef}
        type="file"
        accept={SUPPORTED_IMAGE_ACCEPT}
        hidden
        onChange={(event) => {
          if (event.target.files) onUpload(event.target.files);
          event.target.value = '';
        }}
      />

      <div
        className="product-sku-template-upload-wrap"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          onUpload(event.dataTransfer.files);
        }}
      >
        {uploading && (
          <span className="pk-dropzone-loading product-sku-template-loading" aria-live="polite">
            <Spin size="small" />
          </span>
        )}
        {template ? (
          <div className="product-sku-template-ready">
            <button
              type="button"
              className="product-sku-template-thumb"
              aria-label="预览模板图"
              onClick={() => onPreview(template.url)}
            >
              <img src={assetThumbUrl(template.url, 320) ?? template.url} alt={template.name} />
            </button>
            <div>
              <button type="button" onClick={onEditRegions}>
                重新框选
              </button>
              <button type="button" onClick={() => templateInputRef.current?.click()}>
                更换模板
              </button>
              <button type="button" onClick={onRemove}>
                <X size={12} /> 移除模板
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="product-sku-template-upload"
            onClick={() => templateInputRef.current?.click()}
          >
            <ImagePlus size={22} />
            <strong>点击或拖拽图片到此处上传</strong>
            <span>点击、拖拽或粘贴图片上传，最多 1 张</span>
          </button>
        )}
      </div>
    </section>
  );
}
