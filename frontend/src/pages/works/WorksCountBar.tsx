/**
 * 计数行：作品数在左，排序说明在右。
 *
 * 「张作品」只数有产出的卡片；生成中的任务仍以占位卡出现在网格里，但还不是
 * 作品。计数不能直接用列表长度，否则一个生成中任务就会让我的作品与素材库的
 * 生成图数量对不上。
 */
export interface WorksCountBarProps {
  worksCount: number;
  /** 列表里尚未出图的任务数 */
  pendingCount: number;
  isVideo: boolean;
}

export function WorksCountBar({ worksCount, pendingCount, isVideo }: WorksCountBarProps) {
  return (
    <div className="my-works-count-row">
      <span>
        {worksCount} {isVideo ? '个视频' : '张作品'}
        {pendingCount > 0 && (
          <em className="my-works-count-extra">
            {' · 另有 '}
            {pendingCount}
            {' 个未出图任务'}
          </em>
        )}
      </span>
      <span className="my-works-sort-label">按创作日期倒序</span>
    </div>
  );
}
