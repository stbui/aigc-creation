import { Fragment, useMemo, type ReactNode } from 'react';

import { cn } from '../lib/cn';
import { ImageUploadAddTile } from './image-upload-add-tile';
import { ImageUploadInput } from './image-upload-input';
import { ImageUploadLoading } from './image-upload-loading';
import { ImageUploadPrompt } from './image-upload-prompt';
import { ImageUploadThumb } from './image-upload-thumb';
import type { ImageUploadControls, ImageUploadItem } from './image-upload-types';
import { useImageUploadArea } from './use-image-upload-area';

export type { ImageUploadControls, ImageUploadItem } from './image-upload-types';

export interface ImageUploadAreaProps {
  /** 已上传图片；由页面 / hook 持有，组件只渲染与转交意图 */
  images: ImageUploadItem[];
  /** 数量上限 */
  max: number;
  uploading?: boolean;
  disabled?: boolean;
  /** file input 的 accept */
  accept?: string;
  /** 单图位：input 不带 multiple，空态与缩略图按单列布局 */
  single?: boolean;
  /**
   * `dropzone` 使用通用虚线拖拽区皮肤；`plain` 只保留拖拽命中区与 loading，
   * 视觉完全交给调用方的空态 / 自定义预览（多图融合、SKU 模板图）。
   */
  variant?: 'dropzone' | 'plain';
  /** 追加到外层命中区的页面专属 class */
  className?: string;
  /** 上传区可读名称，作为整块命中区的 group 标签 */
  ariaLabel: string;
  /** 命中区原生 title（悬停提示，如「替换参考图」） */
  title?: string;
  /** 空态内容；优先于内建提示，传入后由内容自行调用 `controls.open` */
  emptyContent?: (controls: ImageUploadControls) => ReactNode;
  /** 内建空态主文案；未传 `emptyContent` 时渲染 */
  emptyTitle?: ReactNode;
  /** 内建空态辅助文案 */
  emptyHint?: ReactNode;
  /** 内建空态图标，默认图片占位图标 */
  emptyIcon?: ReactNode;
  /** 追加到内建空态提示按钮的 class */
  emptyClassName?: string;
  /** 追加到内建空态图标容器的 class */
  emptyIconClassName?: string;
  /** 自定义单张缩略图；需自行渲染移除入口。默认渲染 `<img>` + 移除按钮 */
  renderThumb?: (item: ImageUploadItem, index: number, controls: ImageUploadControls) => ReactNode;
  /** 自定义已选区；优先于 renderThumb，需自行渲染补位块 */
  renderPreview?: (images: ImageUploadItem[], controls: ImageUploadControls) => ReactNode;
  /** 已选满时仍允许点击命中区重新开框（单图「替换」场景） */
  replaceOnClick?: boolean;
  /** 补位按钮可读名称，默认「添加图片」 */
  addLabel?: string;
  /** 移除按钮可读名称，默认「移除 {name}」 */
  removeLabel?: (item: ImageUploadItem) => string;
  /** 选中 / 拖拽落下的文件；校验、上传与额度仍由调用方负责 */
  onFiles: (files: FileList | File[]) => void;
  onRemove?: (id: string) => void;
  onPreview?: (item: ImageUploadItem) => void;
}

/**
 * C 端通用图片上传区（纯组合件）。
 *
 * 交互状态由 `useImageUploadArea` 持有，缩略图 / 补位 / 空态 / loading 各自是
 * 独立原子件；本组件只负责皮肤与编排。校验、上传、额度、素材库与手机上传
 * 仍归页面 / 业务 hook。
 *
 * 视觉走通用 tw 类；页面差异通过 `className` 与 `data-slot` / `data-*` 状态槽位覆盖。
 */
export function ImageUploadArea({
  images,
  max,
  uploading = false,
  disabled = false,
  accept,
  single = false,
  variant = 'dropzone',
  className,
  ariaLabel,
  title,
  emptyContent,
  emptyTitle,
  emptyHint,
  emptyIcon,
  emptyClassName,
  emptyIconClassName,
  renderThumb,
  renderPreview,
  replaceOnClick = false,
  addLabel,
  removeLabel,
  onFiles,
  onRemove,
  onPreview,
}: ImageUploadAreaProps) {
  const filled = images.length > 0;
  const room = images.length < max;
  const plain = variant === 'plain';

  const { inputRef, dragging, open, onZoneClick, onDragOver, onDragLeave, onDrop, onInputChange } =
    useImageUploadArea({
      disabled,
      room,
      filled,
      renderPreviewProvided: Boolean(renderPreview),
      replaceOnClick,
      onFiles,
    });

  const controls = useMemo<ImageUploadControls>(
    () => ({
      open,
      remove: (id) => onRemove?.(id),
      preview: (item) => onPreview?.(item),
      uploading,
      disabled,
    }),
    [open, onRemove, onPreview, uploading, disabled],
  );

  const addTile = room && (
    <ImageUploadAddTile
      label={addLabel ?? '添加图片'}
      disabled={disabled}
      onClick={open}
    />
  );

  const thumbsClass = cn('grid w-full grid-cols-4 gap-2', single && 'max-w-[120px] grid-cols-1');

  return (
    <div
      data-slot="image-upload-area"
      data-variant={variant}
      data-filled={filled || undefined}
      data-dragging={dragging || undefined}
      className={cn(
        plain
          ? 'relative'
          : 'relative grid min-h-40 cursor-pointer place-items-center rounded-md border border-dashed border-border bg-muted p-4 transition-[border-color,background-color,box-shadow] hover:border-brand hover:bg-brand-bg/60 hover:ring-[3px] hover:ring-brand/10',
        !plain && filled && 'min-h-0',
        !plain && dragging && 'border-brand-light bg-brand-bg',
        plain && dragging && 'ring-2 ring-brand/30',
        disabled && 'pointer-events-none opacity-60',
        className,
      )}
      onClick={onZoneClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      role="group"
      aria-label={ariaLabel}
      title={title}
      aria-disabled={disabled || undefined}
      aria-busy={uploading || undefined}
    >
      <ImageUploadInput
        inputRef={inputRef}
        accept={accept}
        multiple={!single}
        disabled={disabled}
        onChange={onInputChange}
      />

      {uploading && <ImageUploadLoading />}

      {!filled && emptyContent ? (
        emptyContent(controls)
      ) : !filled && emptyTitle ? (
        <ImageUploadPrompt
          title={emptyTitle}
          hint={emptyHint}
          icon={emptyIcon}
          className={emptyClassName}
          iconClassName={emptyIconClassName}
          onClick={open}
        />
      ) : !filled ? (
        <div
          data-slot="image-upload-thumbs"
          data-single={single || undefined}
          className={thumbsClass}
        >
          {addTile}
        </div>
      ) : renderPreview ? (
        renderPreview(images, controls)
      ) : (
        <div
          data-slot="image-upload-thumbs"
          data-single={single || undefined}
          className={thumbsClass}
        >
          {images.map((item, index) => {
            if (renderThumb) {
              return <Fragment key={item.id}>{renderThumb(item, index, controls)}</Fragment>;
            }
            return (
              <ImageUploadThumb
                key={item.id}
                item={item}
                removeLabel={removeLabel?.(item) ?? `移除 ${item.name}`}
                disabled={disabled}
                onRemove={onRemove}
              />
            );
          })}
          {addTile}
        </div>
      )}
    </div>
  );
}
