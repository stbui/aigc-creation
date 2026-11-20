import { useRef, type ReactNode } from 'react';
import { ImageIcon, Plus, X } from 'lucide-react';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from '~/admin-ui/components/ui/attachment';
import { Button } from '~/admin-ui/components/ui/button';
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
  /** 触发按钮内容 */
  children?: ReactNode;
  /** 已选文件；由调用方持有，组件只负责渲染与转交选择结果 */
  files?: UploadFile[];
  accept?: string;
  multiple?: boolean;
  /** 位子上限；达到后不再显示触发按钮 */
  maxCount?: number;
  disabled?: boolean;
  className?: string;
  /** 返回 false 表示拒收该文件；不会替调用方发起上传 */
  onSelect?: (file: File, files: File[]) => boolean | Promise<boolean>;
  onRemove?: (file: UploadFile) => boolean | void | Promise<boolean | void>;
  onFilesChange?: (files: UploadFile[]) => void;
  onPreview?: (file: UploadFile) => void;
  /** 是否在缩略图上显示移除按钮 */
  showRemove?: boolean;
}

export function Upload({
  children,
  files = [],
  accept,
  multiple,
  maxCount,
  disabled,
  className,
  onSelect,
  onFilesChange,
  onRemove,
  onPreview,
  showRemove = true,
}: UploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const keyOf = (file: UploadFile, index: number) =>
    String(file.uid ?? (file.originFileObj as File & { uid?: string | number })?.uid ?? `${file.name}-${index}`);

  const pick = async (pickedFiles: FileList | null) => {
    if (!pickedFiles || disabled) return;
    const remaining =
      maxCount === undefined ? pickedFiles.length : Math.max(0, maxCount - files.length);
    const picked = Array.from(pickedFiles).slice(0, remaining);
    const accepted: UploadFile[] = [];
    for (const [index, file] of picked.entries()) {
      const result = await onSelect?.(file, picked);
      if (result === false) continue;
      accepted.push({
        uid: `${Date.now()}-${index}-${file.name}`,
        name: file.name,
        status: 'uploading',
        originFileObj: file,
      });
    }
    if (accepted.length > 0) onFilesChange?.([...files, ...accepted]);
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
      <div className="flex flex-wrap gap-2">
        {files.map((file, index) => (
          <Attachment
            key={keyOf(file, index)}
            state={file.status === 'removed' ? 'error' : (file.status ?? 'done')}
            orientation={file.thumbUrl || file.url ? 'vertical' : 'horizontal'}
          >
            <AttachmentMedia variant={file.thumbUrl || file.url ? 'image' : 'icon'}>
              {file.thumbUrl || file.url ? (
                <img src={file.thumbUrl ?? file.url} alt={file.name} />
              ) : (
                <ImageIcon aria-hidden />
              )}
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{file.name}</AttachmentTitle>
              {file.status === 'uploading' && (
                <AttachmentDescription>上传中…</AttachmentDescription>
              )}
              {file.status === 'error' && <AttachmentDescription>上传失败</AttachmentDescription>}
            </AttachmentContent>
            <AttachmentActions>
              {file.thumbUrl || file.url ? (
                <AttachmentAction
                  aria-label={`预览 ${file.name}`}
                  disabled={disabled}
                  onClick={() => onPreview?.(file)}
                >
                  <ImageIcon aria-hidden />
                </AttachmentAction>
              ) : null}
              {showRemove && (
                <AttachmentAction
                  aria-label={`移除 ${file.name}`}
                  disabled={disabled}
                  onClick={() => void onRemove?.(file)}
                >
                  <X aria-hidden />
                </AttachmentAction>
              )}
            </AttachmentActions>
          </Attachment>
        ))}
        {(!maxCount || files.length < maxCount) && (
          <Button
            type="button"
            variant="ghost"
            className="aspect-square h-auto w-24 shrink-0 rounded-lg border border-dashed border-border bg-secondary p-0 hover:border-brand hover:text-brand"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            {children ?? <Plus aria-hidden />}
          </Button>
        )}
      </div>
    </div>
  );
}
