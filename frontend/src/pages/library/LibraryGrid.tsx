import { LibraryAssetCard } from './LibraryAssetCard';
import { modalityOfFormat } from './components';
import { LibraryLoadMore } from './LibraryLoadMore';
import type { Asset } from '../../types/api';

/**
 * 素材网格：只按 `visible` 截取渲染卡片。
 *
 * 视频卡片不参与大图查看器（`previewIndex = -1`），继续用原生播放器；
 * 剩余条数交给 `LibraryLoadMore` 自行判断是否出现。
 */
export function LibraryGrid({
  assets,
  visible,
  selected,
  lightboxIndexById,
  onLoadMore,
  onToggle,
  onPreview,
  onDownload,
  onRemove,
  onReuse,
}: {
  assets: Asset[];
  /** 当前可见条数（滚动哨兵与「加载更多」共同续加） */
  visible: number;
  selected: string[];
  /** 素材 id → 大图查看器下标，卡片渲染时 O(1) 取值 */
  lightboxIndexById: Map<string, number>;
  onLoadMore: () => void;
  onToggle: (id: string) => void;
  onPreview: (index: number) => void;
  onDownload: (asset: Asset) => void;
  onRemove: (id: string) => void;
  onReuse: (capability: string) => void;
}) {
  return (
    <>
      <div className="asset-library-grid">
        {assets.slice(0, visible).map((a, index) => (
          <LibraryAssetCard
            key={a.id}
            asset={a}
            selected={selected.includes(a.id)}
            priority={index < 5}
            previewIndex={
              modalityOfFormat(a.format) === 'video'
                ? -1
                : lightboxIndexById.get(a.id) ?? -1
            }
            onToggle={onToggle}
            onPreview={onPreview}
            onDownload={onDownload}
            onRemove={onRemove}
            onReuse={onReuse}
          />
        ))}
      </div>

      <LibraryLoadMore remaining={assets.length - visible} onClick={onLoadMore} />
    </>
  );
}
