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
  return (
    <div className={`source-row${uploading ? ' processing' : ''}`}>
      <button
        type="button"
        className="local-source-preview"
        aria-label="预览待重绘商品"
        onClick={onPreview}
      >
        <img src={assetThumbUrl(image.url, 320) ?? image.url} alt="待重绘商品" draggable={false} />
      </button>
      <div>
        <button type="button" disabled={uploading} onClick={onRemove}>
          重新编辑
        </button>
        <button type="button" className="soft" disabled={uploading} onClick={onOpen}>
          重新上传
        </button>
      </div>
    </div>
  );
}
