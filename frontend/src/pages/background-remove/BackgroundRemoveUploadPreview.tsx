import { assetThumbUrl } from './api';
import type { ToolAsset } from './components';

interface BackgroundRemoveUploadPreviewProps {
  image: ToolAsset;
  uploading: boolean;
  onPreview: () => void;
  onOpen: () => void;
}

/** 上传位里的原图预览：查看大图与重新上传。 */
export function BackgroundRemoveUploadPreview({
  image,
  uploading,
  onPreview,
  onOpen,
}: BackgroundRemoveUploadPreviewProps) {
  return (
    <div className={`background-source-row${uploading ? ' processing' : ''}`}>
      <button
        type="button"
        className="background-source-preview"
        aria-label="预览待处理图片"
        onClick={onPreview}
      >
        <img src={assetThumbUrl(image.url, 320) ?? image.url} alt="待处理图片" draggable={false} />
      </button>
      <button
        type="button"
        className="background-source-reupload"
        disabled={uploading}
        onClick={onOpen}
      >
        重新上传
      </button>
    </div>
  );
}
