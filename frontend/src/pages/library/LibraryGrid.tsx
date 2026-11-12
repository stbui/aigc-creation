import { useMemo, type CSSProperties } from 'react';

import { LibraryAssetCard } from './LibraryAssetCard';
import { modalityOfFormat } from './components';
import { LibraryLoadMore } from './LibraryLoadMore';
import { mediaHeightRatio, useMasonryColumns } from './hooks';
import type { Asset } from '../../types/api';

/**
 * 素材网格：按 `visibleCount` 截取后做流水（masonry）排布。
 *
 * 列分布见 `useMasonryColumns`：最短列优先，阅读顺序为从左到右、从上到下，
 * 最新素材在左上角。视频卡片不参与大图查看器（下标固定 -1），继续用原生播放器；
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

interface LibraryGridItem {
  asset: Asset;
  /** 在原始列表中的下标：首屏前 5 张（最新）优先加载 */
  index: number;
}

/** 列高估算：封面按素材宽高比，缺尺寸按 3:4 兜底 */
function estimateHeight(item: LibraryGridItem): number {
  return mediaHeightRatio(item.asset.width, item.asset.height);
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
  const visible = useMemo<LibraryGridItem[]>(
    () => assets.slice(0, visibleCount).map((asset, index) => ({ asset, index })),
    [assets, visibleCount],
  );
  const columns = useMasonryColumns(visible, estimateHeight);

  return (
    <>
      <div
        className="asset-library-grid"
        style={{ ['--asset-library-columns' as string]: columns.length } as CSSProperties}
      >
        {columns.map((column, columnIndex) => (
          <div className="asset-library-column" key={columnIndex}>
            {column.map(({ asset, index }) => (
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
        ))}
      </div>

      <LibraryLoadMore remaining={assets.length - visibleCount} onClick={onLoadMore} />
    </>
  );
}
