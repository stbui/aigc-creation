import { Images } from 'lucide-react';

import type { WorksTab } from './useWorksFilters';

/**
 * 已登录但网格为空。
 *
 * 有筛选条件时不引导去创作（用户已经在找东西，不是没东西），只提示放宽条件；
 * 无筛选时才说明该类作品从哪来，并给「去创作」。
 */
export interface WorksEmptyStateProps {
  tab: WorksTab;
  activeFilterCount: number;
  onGoCreate: () => void;
}

export function WorksEmptyState({ tab, activeFilterCount, onGoCreate }: WorksEmptyStateProps) {
  const filtered = activeFilterCount > 0;
  const isVideo = tab === 'video';
  return (
    <div className="my-works-empty">
      <Images size={72} strokeWidth={1.35} aria-hidden="true" />
      <h2>
        {filtered
          ? isVideo
            ? '没有符合条件的视频'
            : '没有符合条件的作品'
          : isVideo
            ? '还没有视频作品'
            : '还没有作品'}
      </h2>
      <p>
        {filtered
          ? '试试放宽筛选条件，或清除全部筛选。'
          : isVideo
            ? '视频作品来自「图生视频」能力，完成后会出现在这里。'
            : '完成一次创作后，作品会出现在这里。'}
      </p>
      {!filtered && (
        <button type="button" className="my-works-empty-action" onClick={onGoCreate}>
          去创作
        </button>
      )}
    </div>
  );
}
