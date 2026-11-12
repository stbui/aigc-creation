import { ImageLightbox, type LightboxItem } from './components';
import { WorkCard } from './WorkCard';
import type { Task } from '../../types/api';

/**
 * 我的作品 · 卡片网格与大图查看器。
 *
 * 网格只负责按顺序摆放卡片；单卡形态在 `WorkCard`，浮层操作 / 占位卡各有
 * 原子组件。大图列表与网格同源：`lightboxItems` 由页面按当前页签 + 筛选结果
 * 算好，`lightboxIndexById` 让每张卡 O(1) 拿到自己的下标，不再逐卡 findIndex。
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
  return (
    <>
      <div className="my-works-grid">
        {tasks.map((task, index) => (
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
