import type { ReactNode } from 'react';

import { ImageUploadInput } from './image-upload-input';
import { TextAction } from './text-action';
import { useImageUploadArea } from './use-image-upload-area';

export interface ImageUploadTriggerProps {
  children: ReactNode;
  icon?: ReactNode;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
  /** 选中文件；校验与上传仍由调用方负责 */
  onFiles: (files: FileList | File[]) => void;
}

/**
 * 文字型图片上传入口（如变体区域内的「上传参考图」）。
 *
 * 交互与 `ImageUploadArea` 共用 `useImageUploadArea` 和同一个隐藏 input 原子件；
 * 只把命中区换成一行 `TextAction`，适合塞进已有工具条。
 */
export function ImageUploadTrigger({
  children,
  icon,
  accept,
  multiple = false,
  disabled = false,
  className,
  onFiles,
}: ImageUploadTriggerProps) {
  const { inputRef, open, onInputChange } = useImageUploadArea({
    disabled,
    room: true,
    filled: false,
    renderPreviewProvided: false,
    onFiles,
  });

  return (
    <>
      <TextAction icon={icon} disabled={disabled} onClick={open} className={className}>
        {children}
      </TextAction>
      <ImageUploadInput
        inputRef={inputRef}
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={onInputChange}
      />
    </>
  );
}
