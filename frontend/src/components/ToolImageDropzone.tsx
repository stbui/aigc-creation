import { useState, type RefObject } from 'react';
import { App, Spin } from 'antd';
import { ImagePlus, Plus, X } from 'lucide-react';

/**
 * 工具页图片上传区 —— 2026-10-19 从 4 个大页面抽出。
 *
 * 抽出前的事实（difflib 归一化比对，见 docs/refactor-dedup.md §1）：
 *   ProductKitPage:270-353 ⇄ ProductDetailPage:259-342 ⇄ ViralClonePage:274-357
 *   三处 **逐字节相同（diff 输出 0 行）**；FreeCreationPage:159-242 为同一结构变体
 *   （标题无必填星号、上限 4 张）。全项目共 4 份。
 *
 * 为什么值得抽：这些 class（`pk-upload-title-row` / `pk-dropzone` / `pk-thumb-grid` …）
 * 是参考站逐页实拍值，**一个字都不能改**；此前 4 份拷贝意味着任何一处微调都要同步 4 次，
 * 漏改即产生页面间漂移（10-19 已因「覆盖层静态重述」吃过同类的亏）。
 *
 * 组件边界刻意划在「标题行 + 拖拽框 + 缩略图网格」这一段：
 *   - 上传校验/上传调用/素材库回填仍归页面（各页文案与限制不同）
 *   - `dragging` 由组件内部持有（全项目仅上传区用，页面侧无其他消费点）
 */

export interface ToolUploadImage {
  id: string;
  url: string;
  name: string;
}

interface Props {
  /** 区块标题, 如「上传商品图」/「上传参考图」 */
  title: string;
  /** 标题前是否带红色必填星号（参考站「上传商品图」带、「上传参考图」不带） */
  required?: boolean;
  images: ToolUploadImage[];
  /** 数量上限 */
  max: number;
  /** 单张体积上限 (MB) */
  maxMb: number;
  uploading: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList | File[]) => void;
  onRemove: (id: string) => void;
  onOpenLibrary: () => void;
  /** 空态文案里的名词, 如「商品图片」/「参考图片」 */
  noun?: string;
  /** file input 的 accept, 缺省与参考站一致 */
  accept?: string;
  /* ── 以下为「爆款复刻 · 参考图」区与「自由创作 · 参考图」区的差异化开关 ── */
  /** 额外挂到 .pk-section 上的 class, 如 vc-reference-section */
  sectionClassName?: string;
  /** 额外挂到 .pk-dropzone 上的 class, 如 pk-dropzone-reference */
  dropzoneClassName?: string;
  /** 单图模式: 不渲染「+」补位按钮, file input 不带 multiple */
  single?: boolean;
  /** 标题行右侧是否显示「n/max」计数器（参考图区无计数器） */
  showCount?: boolean;
  /** 自定义空态副文案; 不传则用「最多可上传 n 张{noun}，单张不超过 xMB」 */
  emptyHint?: string;
}

export function ToolImageDropzone({
  title,
  required = true,
  images,
  max,
  maxMb,
  uploading,
  fileInputRef,
  onFiles,
  onRemove,
  onOpenLibrary,
  noun = '商品图片',
  accept = 'image/png,image/jpeg,image/webp,image/gif',
  sectionClassName,
  dropzoneClassName,
  single = false,
  showCount = true,
  emptyHint,
}: Props) {
  const { message } = App.useApp();
  const [dragging, setDragging] = useState(false);

  return (
    <div className={`pk-section${sectionClassName ? ` ${sectionClassName}` : ''}`}>
      <div className="pk-upload-title-row">
        <strong className="pk-section-title">
          {required && <i className="pk-required-mark">*</i>}
          {title}
        </strong>
        <div className="pk-upload-title-actions">
          <button type="button" className="pk-text-link" onClick={onOpenLibrary}>
            从素材库导入
          </button>
          <button
            type="button"
            className="pk-text-link"
            title="本地演示环境暂不支持手机上传"
            onClick={() =>
              message.info(
                single
                  ? '本地演示环境暂不支持手机上传，可直接拖拽上传'
                  : '本地演示环境暂不支持手机上传，可直接拖拽或粘贴上传',
              )
            }
          >
            手机上传
          </button>
          {showCount && (
            <span className="pk-upload-count">
              {images.length}/{max}
            </span>
          )}
        </div>
      </div>

      <div
        className={`pk-dropzone${dropzoneClassName ? ` ${dropzoneClassName}` : ''}${dragging ? ' pk-dropzone-dragging' : ''}${images.length > 0 ? ' pk-dropzone-filled' : ''}`}
        onClick={() => images.length < max && fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          multiple={!single}
          hidden
          onChange={(e) => {
            if (e.target.files) onFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {uploading && (
          <div className="pk-dropzone-loading">
            <Spin size="small" />
          </div>
        )}
        {images.length === 0 ? (
          <label className="pk-upload-prompt">
            <ImagePlus size={14} />
            <span>点击、拖拽或粘贴{noun}到此处上传</span>
            <small>{emptyHint ?? `最多可上传 ${max} 张${noun}，单张不超过 ${maxMb}MB`}</small>
          </label>
        ) : (
          <div className={`pk-thumb-grid${single ? ' pk-thumb-grid-single' : ''}`}>
            {images.map((img) => (
              <div key={img.id} className="pk-thumb">
                <img src={img.url} alt={img.name} loading="lazy" decoding="async" />
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
            {!single && images.length < max && (
              <button
                type="button"
                className="pk-thumb-add"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                <Plus size={18} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}