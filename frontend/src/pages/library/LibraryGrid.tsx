import { LibraryAssetCard } from './LibraryAssetCard';
import { modalityOfFormat } from './components';
import { LibraryLoadMore } from './LibraryLoadMore';
import type { Asset } from '../../types/api';

/**
 * 素材网格：只按 `visibleCount` 截取渲染卡片。
 *
 * 视频卡片不参与大图查看器（下标固定 -1），继续用原生播放器；
 * 剩余条数交给 `LibraryLoadMore` 自行判断是否出现。
 */
export interface LibraryGridProps {
  assets: Asset[];
  /** 当前可见条数（滚动哨兵与「加载更多」共同续加） */
  visibleCount: number;
  selectedIds: string[];
  /** 素材 id → 大图查看器下标，卡片渲染时 O(1) 取值 */
  lightboxIndexById: Map<string, number>;
  onLoadMore: () => void;
  onToggle: (id: string) => void;
  onPreview: (index: number) => void;
  onDownload: (asset: Asset) => void;
  onRemove: (id: string) => void;
  onReuse: (capabilityId: string) => void;
}

export function LibraryGrid({
  assets,
  visibleCount,
  selectedIds,
  lightboxIndexById,
  onLoadMore,
  onToggle,
  onPreview,
  onDownload,
  onRemove,
  onReuse,
}: LibraryGridProps) {
  return (
    <>
      <div className="asset-library-grid">
        {assets.slice(0, visibleCount).map((asset, index) => (
          <LibraryAssetCard
            key={asset.id}
            asset={asset}
            selected={selectedIds.includes(asset.id)}
            priority={index < 5}
            lightboxIndex={
              modalityOfFormat(asset.format) === 'video'
                ? -1
                : lightboxIndexById.get(asset.id) ?? -1
            }
            onToggle={onToggle}
            onPreview={onPreview}
            onDownload={onDownload}
            onRemove={onRemove}
            onReuse={onReuse}
          />
        ))}
      </div>

      <LibraryLoadMore remaining={assets.length - visibleCount} onClick={onLoadMore} />
    </>
  );
}
