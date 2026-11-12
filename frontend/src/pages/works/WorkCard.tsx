import { Check } from 'lucide-react';

import { assetSrc, assetThumbSrc } from './api';
import { ResultMedia, WorkImage } from './components';
import { capabilityById, capabilityName, formatCreatedAt, taskModality } from './utils';
import { WorkCardActionBar } from './WorkCardActionBar';
import { WorkCardPlaceholder } from './WorkCardPlaceholder';
import type { Task } from '../../types/api';

/**
 * 我的作品 · 单张作品卡。
 *
 * 媒体形态：已出图的图片点开大图查看器，视频给原生播放器（不能被 `<button>`
 * 包住）；无产出任务显示占位卡，可删除 / 失败可重试。卡片只负责展示与转发
 * 事件，删除确认、下载、重试都留在页面。
 */
export interface WorkCardProps {
  task: Task;
  selected: boolean;
  /** 首屏前两张：不懒加载 */
  priority?: boolean;
  /** 在大图查看器里的下标；-1 = 视频 / 无产出，不参与翻页 */
  lightboxIndex: number;
  retrying: boolean;
  onToggleSelect: (id: string) => void;
  onPreview: (index: number) => void;
  onRetry: (task: Task) => void;
  onDownload: (task: Task) => void;
  onRemove: (id: string) => void;
  onReuse: (capabilityId: string) => void;
}

export function WorkCard({
  task,
  selected,
  priority,
  lightboxIndex,
  retrying,
  onToggleSelect,
  onPreview,
  onRetry,
  onDownload,
  onRemove,
  onReuse,
}: WorkCardProps) {
  const capability = capabilityById(task.capability);
  const fullUrl = task.outputAsset ? assetSrc(task.outputAsset) : undefined;
  const isVideo = taskModality(task) === 'video';
  // 网格只显示缩略图；点开查看器 / 下载仍走完整地址 (lightboxItems / downloadSelected)
  const src = isVideo ? fullUrl : assetThumbSrc(task.outputAsset, 640) ?? fullUrl;
  const hasOutput = Boolean(src);
  const canPreview = hasOutput && lightboxIndex >= 0;

  return (
    <article className={`my-work-card${selected ? ' selected' : ''}`}>
      <div
        className={`my-work-media${isVideo ? ' is-video' : ''}${hasOutput ? '' : ' is-placeholder'}`}
      >
        {src ? (
          isVideo ? (
            <ResultMedia
              url={src}
              modality="video"
              // 视频没有容器元数据可写, 显式标识只能由播放器侧补 (图片已烙进像素)
              aigc={task.outputAsset?.aigc}
              alt={capabilityName(task.capability)}
            />
          ) : (
            <WorkImage
              src={src}
              alt={capabilityName(task.capability)}
              priority={priority}
              onOpen={() => {
                if (canPreview) onPreview(lightboxIndex);
              }}
            />
          )
        ) : (
          <WorkCardPlaceholder
            task={task}
            capability={capability}
            retrying={retrying}
            onRetry={() => onRetry(task)}
          />
        )}

        <WorkCardActionBar
          canReuse={hasOutput}
          canPreview={canPreview}
          canDownload={hasOutput}
          onReuse={() => onReuse(task.capability)}
          onPreview={() => onPreview(lightboxIndex)}
          onDownload={() => onDownload(task)}
          onRemove={() => onRemove(task.id)}
        />
      </div>

      {/* 没有产出的生成中任务不能勾选: 下载的是文件, 不能把「任务」当成作品选中 */}
      {hasOutput && (
        <label className="my-work-check" onClick={(event) => event.stopPropagation()}>
          <input type="checkbox" checked={selected} onChange={() => onToggleSelect(task.id)} />
          <span>{selected && <Check size={11} />}</span>
        </label>
      )}

      <div className="my-work-caption">
        <span className="my-work-caption-name">{capabilityName(task.capability)}</span>
        <small>{formatCreatedAt(task.createdAt)}</small>
      </div>
    </article>
  );
}
