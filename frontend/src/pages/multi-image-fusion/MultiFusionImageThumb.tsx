import { X } from 'lucide-react';

import type { ToolAsset } from './components';
import { assetThumbUrl } from './api';

/**
 * 已上传图片的缩略卡（主体图与搭配图共用）。
 *
 * 只负责渲染一张图 + 移除按钮 + 上传中角标；移除行为由图位持有者决定。
 * 缩略图走 `assetThumbUrl`，避免在 5 张搭配图的网格里直接拉原图。
 */
export function MultiFusionImageThumb({
  asset,
  uploading,
  removeLabel,
  onRemove,
}: {
  asset: ToolAsset;
  uploading: boolean;
  /** 无障碍标签：主体图与搭配图的语义不同 */
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <div className="multi-image-fusion-image-card">
      <img
        src={assetThumbUrl(asset.url, 320) ?? asset.url}
        alt={asset.name}
        loading="lazy"
        decoding="async"
      />
      <button
        type="button"
        className="multi-image-fusion-remove"
        aria-label={removeLabel}
        onClick={onRemove}
      >
        <X size={12} />
      </button>
      {uploading && <span className="multi-image-fusion-uploading">上传中</span>}
    </div>
  );
}
