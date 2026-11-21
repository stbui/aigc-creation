import { assetThumbUrl } from './api';
import type { ToolAsset } from './components';

interface LocalRedrawUploadPreviewProps {
  image: ToolAsset;
  uploading: boolean;
  onPreview: () => void;
  onRemove: () => void;
  onOpen: () => void;
}

/** 上传位里的原图预览：查看大图、回到画布、重新上传。 */
export function LocalRedrawUploadPreview({
  image,
  uploading,
  onPreview,
  onRemove,
  onOpen,
}: LocalRedrawUploadPreviewProps) {
  const action =
    'h-10 cursor-pointer whitespace-nowrap rounded-[var(--radius-control)] border border-border bg-card px-4 text-sm text-[color:var(--text-body)] hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50 min-[901px]:max-[1366px]:w-full min-[901px]:max-[1366px]:min-w-0 min-[901px]:max-[1366px]:px-1.5 min-[901px]:max-[1366px]:text-xs max-[900px]:w-[88px] max-[900px]:min-w-[88px] max-[900px]:px-3';

  return (
    <div className="source-row relative flex h-40 w-full items-center justify-center gap-6 min-[901px]:max-[1366px]:flex-col min-[901px]:max-[1366px]:gap-2.5 max-[900px]:gap-3">
      {uploading && (
        <span className="pointer-events-none absolute inset-0 z-2 flex items-center justify-center rounded-[var(--radius-control)] bg-[rgba(17,24,39,0.35)] text-xs text-card">
          处理中…
        </span>
      )}
      <button
        type="button"
        className="local-source-preview h-40 w-40 flex-none cursor-pointer overflow-hidden rounded-[var(--radius-control)] border border-border bg-[var(--surface)] p-0"
        aria-label="预览待重绘商品"
        onClick={onPreview}
      >
        <img
          className="block size-full object-cover"
          src={assetThumbUrl(image.url, 320) ?? image.url}
          alt="待重绘商品"
          draggable={false}
        />
      </button>
      <div className="grid gap-2.5 min-[901px]:max-[1366px]:w-full min-[901px]:max-[1366px]:grid-cols-2 min-[901px]:max-[1366px]:gap-2">
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
