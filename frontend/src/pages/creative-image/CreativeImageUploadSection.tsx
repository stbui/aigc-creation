import { useRef, useState } from 'react';
import { ImagePlus, Plus } from 'lucide-react';

import { MAX_IMAGE_MB, SUPPORTED_IMAGE_ACCEPT } from './constants';
import type { ToolAsset } from './components';
import { CreativeImageReferenceThumb } from './CreativeImageReferenceThumb';
import { Spin } from '../../ui';

interface CreativeImageUploadSectionProps {
  images: ToolAsset[];
  /** 参考图位数上限（本页固定 4，由页面下发） */
  maxImages: number;
  uploading: boolean;
  /** 拿到文件后由页面统一做格式 / 体积 / 额度校验与上传 */
  onUploadFiles: (files: FileList | File[]) => void | Promise<void>;
  onRemoveImage: (id: string) => void;
  onMoveImage: (index: number, direction: -1 | 1) => void;
  onOpenLibrary: () => void;
  onOpenMobile: () => void;
}

/**
 * 参考图上传区：空态占位、拖拽 / 点击 / 粘贴入口、缩略图网格与排序。
 *
 * 文件选择框由本组件自持（隐藏 input），页面只关心「拿到文件」；
 * 拖拽高亮是本组件的局部视觉状态，不进入页面状态。
 */
export function CreativeImageUploadSection({
  images,
  maxImages,
  uploading,
  onUploadFiles,
  onRemoveImage,
  onMoveImage,
  onOpenLibrary,
  onOpenMobile,
}: CreativeImageUploadSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const hasRoom = images.length < maxImages;

  const openFilePicker = () => {
    if (!hasRoom) return;
    fileInputRef.current?.click();
  };

  return (
    <div className="pk-section fc-upload-section">
      <div className="pk-upload-title-row">
        <strong className="pk-section-title">上传参考图</strong>
        <div className="pk-upload-title-actions">
          <button type="button" className="pk-text-link" onClick={onOpenLibrary}>
            从素材库导入
          </button>
          <button
            type="button"
            className="pk-text-link"
            title="扫码在手机上选择图片，接收后自动进入参考图位"
            onClick={onOpenMobile}
          >
            手机上传
          </button>
          <span className="pk-upload-count">
            {images.length}/{maxImages}
          </span>
        </div>
      </div>

      <div
        className={`pk-dropzone fc-dropzone${dragging ? ' pk-dropzone-dragging' : ''}${images.length > 0 ? ' fc-dropzone-ready' : ''}`}
        onClick={openFilePicker}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void onUploadFiles(event.dataTransfer.files);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={SUPPORTED_IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) void onUploadFiles(event.target.files);
            event.target.value = '';
          }}
        />
        {uploading && (
          <div className="pk-dropzone-loading">
            <Spin size="small" />
          </div>
        )}
        {images.length === 0 ? (
          <label className="pk-upload-prompt fc-upload-prompt">
            <ImagePlus size={14} />
            <span>点击、拖拽或粘贴参考图片到此处上传</span>
            <small>
              最多可上传 {maxImages} 张参考图片，单张不超过 {MAX_IMAGE_MB}MB
            </small>
          </label>
        ) : (
          <>
            <div className="fc-thumb-grid">
              {images.map((image, index) => (
                <CreativeImageReferenceThumb
                  key={image.id}
                  image={image}
                  index={index}
                  total={images.length}
                  onMove={onMoveImage}
                  onRemove={onRemoveImage}
                />
              ))}
              {hasRoom && (
                <button
                  type="button"
                  className="fc-thumb-add"
                  onClick={(event) => {
                    event.stopPropagation();
                    openFilePicker();
                  }}
                >
                  <Plus size={18} />
                  <span>添加</span>
                </button>
              )}
            </div>
            <p className="fc-sort-tip">使用箭头调整参考图顺序，顺序会影响生成构图</p>
          </>
        )}
      </div>
    </div>
  );
}
