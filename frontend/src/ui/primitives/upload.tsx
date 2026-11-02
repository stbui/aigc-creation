import { useRef, type ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface UploadFile {
  uid?: string | number;
  name: string;
  status?: 'uploading' | 'done' | 'error' | 'removed';
  url?: string;
  thumbUrl?: string;
  percent?: number;
  originFileObj?: File;
}

export interface UploadProps {
  children?: ReactNode;
  /** 目前 C 端只使用 picture-card，但保留属性避免页面改动。 */
  listType?: 'text' | 'picture' | 'picture-card';
  fileList?: UploadFile[];
  accept?: string;
  multiple?: boolean;
  maxCount?: number;
  disabled?: boolean;
  className?: string;
  beforeUpload?: (file: File, fileList: File[]) => boolean | Promise<boolean | string> | string;
  onRemove?: (file: UploadFile) => boolean | void | Promise<boolean | void>;
  onChange?: (info: { fileList: UploadFile[] }) => void;
  onPreview?: (file: UploadFile) => void;
  showUploadList?: boolean;
}

const LIST_IGNORE = 'LIST_IGNORE';

function UploadInner({
  children,
  fileList = [],
  accept,
  multiple,
  maxCount,
  disabled,
  className,
  beforeUpload,
  onRemove,
  onPreview,
  showUploadList = true,
}: UploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const keyOf = (file: UploadFile, index: number) =>
    String(file.uid ?? (file.originFileObj as File & { uid?: string | number })?.uid ?? `${file.name}-${index}`);

  const pick = async (files: FileList | null) => {
    if (!files || disabled) return;
    const picked = Array.from(files).slice(0, maxCount ?? files.length);
    for (const file of picked) {
      const result = await beforeUpload?.(file, picked);
      if (result === false || result === LIST_IGNORE) continue;
      if (typeof result === 'string' && result === LIST_IGNORE) continue;
    }
  };

  return (
    <div
      className={cn('ui-upload', disabled && 'is-disabled', className)}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void pick(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(event) => {
          void pick(event.target.files);
          event.target.value = '';
        }}
      />
      <div className="ui-upload-list">
        {fileList.map((file, index) => (
          <div key={keyOf(file, index)} className="ui-upload-item">
            {(file.thumbUrl || file.url) && (
              <button
                type="button"
                className="ui-upload-thumb"
                onClick={() => onPreview?.(file)}
                aria-label={`预览 ${file.name}`}
              >
                <img src={file.thumbUrl ?? file.url} alt={file.name} />
              </button>
            )}
            {showUploadList && (
              <button
                type="button"
                className="ui-upload-remove"
                aria-label={`移除 ${file.name}`}
                disabled={disabled}
                onClick={() => void onRemove?.(file)}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {(!maxCount || fileList.length < maxCount) && (
          <button
            type="button"
            className="ui-upload-trigger"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            {children}
          </button>
        )}
      </div>
    </div>
  );
}

/** antd Upload 的兼容壳：C 端只用 picture-card + 自定义上传逻辑。 */
export const Upload = Object.assign(UploadInner, { LIST_IGNORE });
