import { useMemo, type CSSProperties } from 'react';

import { ImageLightbox, type LightboxItem } from './components';
import { mediaHeightRatio, useMasonryColumns } from './hooks';
import { WorkCard } from './WorkCard';
import { taskModality } from './utils';
import type { Task } from '../../types/api';

/**
 * 我的作品 · 卡片流水网格与大图查看器。
 *
 * 列分布见 `useMasonryColumns`：最短列优先，阅读顺序为从左到右、从上到下，
 * 最新作品在左上角。单卡形态在 `WorkCard`，浮层操作 / 占位卡各有原子组件。
 * 大图列表与网格同源：`lightboxItems` 由页面按当前页签 + 筛选结果算好，
 * `lightboxIndexById` 让每张卡 O(1) 拿到自己的下标，不再逐卡 findIndex。
 */
export interface WorksGridProps {
  /** 当前页签下、已按可见数量切片的任务 */
  tasks: Task[];
  selectedIds: string[];
  lightboxItems: LightboxItem[];
  lightboxIndexById: Map<string, number>;
  previewIndex: number | null;
  retryingId: string | null;
  onToggleSelect: (id: string) => void;
  onPreview: (index: number | null) => void;
  onRetry: (task: Task) => void;
  onDownload: (task: Task) => void;
  onRemove: (id: string) => void;
  onReuse: (capabilityId: string) => void;
}

interface WorksGridItem {
  task: Task;
  /** 在原始列表中的下标：首屏前两张优先加载 */
  index: number;
}

/** 列高估算：图片按产出宽高比，视频 16:9，无产出占位卡按方形 */
function estimateHeight(item: WorksGridItem): number {
  if (taskModality(item.task) === 'video') return 9 / 16;
  return mediaHeightRatio(item.task.outputAsset?.width, item.task.outputAsset?.height, 1);
}

export function WorksGrid({
  tasks,
  selectedIds,
  lightboxItems,
  lightboxIndexById,
  previewIndex,
  retryingId,
  onToggleSelect,
  onPreview,
  onRetry,
  onDownload,
  onRemove,
  onReuse,
}: WorksGridProps) {
  const items = useMemo<WorksGridItem[]>(
    () => tasks.map((task, index) => ({ task, index })),
    [tasks],
  );
  const columns = useMasonryColumns(items, estimateHeight);

  return (
    <>
      <div
        className="my-works-grid"
        style={{ ['--works-columns' as string]: columns.length } as CSSProperties}
      >
        {columns.map((column, columnIndex) => (
          <div className="my-works-column" key={columnIndex}>
            {column.map(({ task, index }) => (
              <WorkCard
                key={task.id}
                task={task}
                selected={selectedIds.includes(task.id)}
                priority={index < 2}
                lightboxIndex={lightboxIndexById.get(task.id) ?? -1}
                retrying={retryingId === task.id}
                onToggleSelect={onToggleSelect}
                onPreview={onPreview}
                onRetry={onRetry}
                onDownload={onDownload}
                onRemove={onRemove}
                onReuse={onReuse}
              />
            ))}
          </div>
        ))}
      </div>

      {/* 大图查看器: 与结果栏同一套 (缩放 / 拖拽 / ←→ 翻页 / Esc 关闭) */}
      {previewIndex !== null && lightboxItems[previewIndex] && (
        <ImageLightbox
          items={lightboxItems}
          index={previewIndex}
          onIndexChange={onPreview}
          onClose={() => onPreview(null)}
        />
      )}
    </>
  );
}
