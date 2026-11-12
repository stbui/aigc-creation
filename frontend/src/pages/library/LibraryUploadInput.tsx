import type { RefObject } from 'react';

/**
 * 隐藏的文件选择框。
 *
 * 上传入口统一走它：页面按钮与空态按钮都只需 `inputRef.current?.click()`；
 * 选完即清空 value，保证同一文件可以重复选择。
 */
export interface LibraryUploadInputProps {
  inputRef: RefObject<HTMLInputElement | null>;
  accept: string;
  onSelect: (files: FileList) => void;
}

export function LibraryUploadInput({ inputRef, accept, onSelect }: LibraryUploadInputProps) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      multiple
      hidden
      onChange={(event) => {
        if (event.target.files) onSelect(event.target.files);
        event.target.value = '';
      }}
    />
  );
}
