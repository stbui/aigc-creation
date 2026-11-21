import { assetThumbUrl } from './api';
import type { ToolAsset } from './components';

interface WatermarkRemoveUploadPreviewProps {
  image: ToolAsset;
  uploading: boolean;
  onPreview: () => void;
  onRemove: () => void;
  onOpen: () => void;
}

/** 上传位里的原图预览：查看大图、回到画布、重新上传。 */
export function WatermarkRemoveUploadPreview({
  image,
  uploading,
  onPreview,
  onRemove,
  onOpen,
}: WatermarkRemoveUploadPreviewProps) {
  const action =
    'h-10 min-w-[88px] cursor-pointer whitespace-nowrap rounded-[var(--radius-control)] border border-border bg-card px-3 text-sm text-[color:var(--text-body)] hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="source-row relative flex h-40 w-full items-center justify-center gap-3">
      {uploading && (
        <span className="pointer-events-none absolute inset-0 z-2 flex items-center justify-center rounded-[var(--radius-control)] bg-[rgba(17,24,39,0.35)] text-xs text-card">
          处理中…
        </span>
      )}
      <button
        type="button"
        className="local-source-preview h-40 w-40 flex-none cursor-pointer overflow-hidden rounded-[var(--radius-control)] border border-border bg-[var(--surface)] p-0"
        aria-label="预览待去水印图片"
        onClick={onPreview}
      >
        <img
          className="block size-full object-cover"
          src={assetThumbUrl(image.url, 320) ?? image.url}
          alt="待去水印图片"
          draggable={false}
        />
      </button>
      <div className="grid gap-2.5">
        <button type="button" className={action} disabled={uploading} onClick={onRemove}>
          重新编辑
        </button>
        <button
          type="button"
          className={`${action} border-transparent bg-[var(--color-border-soft)]`}
          disabled={uploading}
          onClick={onOpen}
        >
          重新上传
        </button>
      </div>
    </div>
  );
}
