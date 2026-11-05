import { RefreshCw, Trash2 } from 'lucide-react';

import { assetThumbUrl } from './api';
import type { ToolAsset, UploadPreviewControls } from './components';

/**
 * 单图上传后的首帧预览。
 *
 * 图生视频的唯一输入是「起始画面」，因此缩略图不按普通图片工具的小方格拉平，
 * 而是保留原始构图给用户确认。重新上传复用 ToolShell 的替换语义，避免单图位
 * 因「最多 1 张」的额度规则拒绝新文件。
 */
export function VideoUploadPreview({
  image,
  controls,
}: {
  image: ToolAsset;
  controls: UploadPreviewControls;
}) {
  return (
    <div className={`image-to-video-upload-preview${controls.uploading ? ' is-uploading' : ''}`}>
      <button
        type="button"
        className="image-to-video-upload-frame"
        aria-label="预览首帧图片"
        onClick={() => controls.preview(image)}
      >
        <img
          src={assetThumbUrl(image.url, 720) ?? image.url}
          alt="图生视频首帧"
          draggable={false}
        />
        <span>首帧</span>
      </button>
      <div className="image-to-video-upload-meta">
        <strong title={image.name}>{image.name || '首帧图片'}</strong>
        <p>这张图片将作为视频的起始画面</p>
        <div className="image-to-video-upload-actions">
          <button type="button" disabled={controls.uploading} onClick={controls.open}>
            <RefreshCw size={13} />
            更换图片
          </button>
          <button type="button" disabled={controls.uploading} onClick={() => controls.remove(image.id)}>
            <Trash2 size={13} />
            移除
          </button>
        </div>
      </div>
    </div>
  );
}
