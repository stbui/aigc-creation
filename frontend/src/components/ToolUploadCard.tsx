import { ImagePlus, Plus, X } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { assetThumbUrl } from '../lib/api';
import { Spin } from '../ui';
import type { ToolAsset, UploadSpec, UploadPreviewControls } from './toolShellTypes';

/**
 * 工具页左栏的「上传卡」。
 *
 * 2026-11-14 从 `ToolShell` 抽出：只负责把图片位渲染成可拖拽的 dropzone
 * （标题行 + 素材库/手机上传入口 + 缩略图网格或页面自定义预览），
 * 图片位的状态与写操作在 `useToolUploadSlots`，本组件只读不写业务规则。
 */
interface Props {
  upload: UploadSpec;
  images: ToolAsset[];
  uploading: boolean;
  dragging: boolean;
  allowedAccept: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  /** 自定义已上传图片位（局部重绘的预览 / 重新编辑 / 重新上传）。 */
  renderUploadPreview?: (images: ToolAsset[], controls: UploadPreviewControls) => ReactNode;
  onDragStateChange: (dragging: boolean) => void;
  onDropFiles: (files: FileList) => void;
  onPickFiles: (files: FileList) => void;
  onOpenLibrary: () => void;
  onOpenMobile: () => void;
  onRemove: (id: string) => void;
  onPreview: (image: ToolAsset) => void;
}

export function ToolUploadCard({
  upload,
  images,
  uploading,
  dragging,
  allowedAccept,
  fileInputRef,
  renderUploadPreview,
  onDragStateChange,
  onDropFiles,
  onPickFiles,
  onOpenLibrary,
  onOpenMobile,
  onRemove,
  onPreview,
}: Props) {
  const filled = images.length > 0;

  return (
    <section className="pk-config-card">
      <div className="pk-section">
        <div className="pk-upload-title-row">
          <strong className="pk-section-title u-font-14">
            {upload.required && <i className="pk-required-mark u-font-14">*</i>}
            {upload.title}
          </strong>
          <div className="pk-upload-title-actions">
            <button type="button" className="pk-text-link u-font-12" onClick={onOpenLibrary}>
              从素材库导入
            </button>
            <button
              type="button"
              className="pk-text-link pk-mobile-upload-link u-font-12"
              title="用手机扫码上传，图片回填到左侧"
              onClick={onOpenMobile}
            >
              手机上传
            </button>
            {upload.max > 1 && (
              <span className="pk-upload-count u-font-16">
                {images.length}/{upload.max}
              </span>
            )}
          </div>
        </div>

        <div
          className={`pk-dropzone${dragging ? ' pk-dropzone-dragging' : ''}${filled ? ' pk-dropzone-filled' : ''}`}
          onClick={() => images.length < upload.max && fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            onDragStateChange(true);
          }}
          onDragLeave={() => onDragStateChange(false)}
          onDrop={(e) => {
            e.preventDefault();
            onDragStateChange(false);
            onDropFiles(e.dataTransfer.files);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={upload.accept ?? allowedAccept}
            multiple={upload.max > 1}
            hidden
            onChange={(e) => {
              if (e.target.files) onPickFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {uploading && (
            <div className="pk-dropzone-loading">
              <Spin className="size-4" />
            </div>
          )}
          {images.length === 0 ? (
            <label className="pk-upload-prompt">
              {upload.promptIcon ?? <Plus size={22} />}
              <span>{upload.prompt ?? '点击或拖拽图片到此处上传'}</span>
              <small>{upload.hint}</small>
            </label>
          ) : renderUploadPreview ? (
            renderUploadPreview(images, {
              open: () => fileInputRef.current?.click(),
              remove: onRemove,
              preview: onPreview,
              uploading,
            })
          ) : (
            <div className={`pk-thumb-grid${images.length === 1 ? ' pk-thumb-grid-single' : ''}`}>
              {images.map((img) => (
                <div key={img.id} className="pk-thumb">
                  <img
                    src={assetThumbUrl(img.url, 320) ?? img.url}
                    alt={img.name}
                    loading="lazy"
                    decoding="async"
                  />
                  <button
                    type="button"
                    className="pk-thumb-remove"
                    aria-label={`移除 ${img.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(img.id);
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {images.length < upload.max && (
                <button
                  type="button"
                  className="pk-thumb-add"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  <ImagePlus size={18} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
