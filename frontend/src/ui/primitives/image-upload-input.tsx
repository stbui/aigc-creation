import type { ChangeEvent, RefObject } from 'react';

export interface ImageUploadInputProps {
  inputRef: RefObject<HTMLInputElement | null>;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** 由 `useImageUploadArea().onInputChange` 提供：回传文件并清空 value */
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

/** 图片上传的隐藏 input；只做 DOM 挂载与属性透传，不持有选择逻辑。 */
export function ImageUploadInput({
  inputRef,
  accept,
  multiple,
  disabled,
  onChange,
}: ImageUploadInputProps) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      multiple={multiple}
      hidden
      disabled={disabled}
      onChange={onChange}
    />
  );
}
