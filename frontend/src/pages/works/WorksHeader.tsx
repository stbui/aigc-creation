import { RefreshCw } from 'lucide-react';

import type { WorksTab } from './useWorksFilters';

/** 页头：标题 / 说明 + 刷新；页签紧跟在页头下方 */
export interface WorksHeaderProps {
  loading: boolean;
  /** 访客不可刷新（作品接口需鉴权） */
  canRefresh: boolean;
  tab: WorksTab;
  onRefresh: () => void;
  onSwitchTab: (tab: WorksTab) => void;
}

const TABS: ReadonlyArray<{ value: WorksTab; label: string }> = [
  { value: 'image', label: '图片作品' },
  { value: 'video', label: '视频作品' },
];

export function WorksHeader({
  loading,
  canRefresh,
  tab,
  onRefresh,
  onSwitchTab,
}: WorksHeaderProps) {
  return (
    <>
      <header className="my-works-head">
        <div className="my-works-heading">
          <h1>我的作品</h1>
          <p>所有生成产出都汇总在这里，可查看大图、批量下载或再次创作。</p>
        </div>
        <button
          type="button"
          className="my-works-refresh"
          disabled={loading || !canRefresh}
          onClick={onRefresh}
        >
          <RefreshCw size={14} className={loading ? 'my-work-generating-spinner' : undefined} />
          刷新
        </button>
      </header>
      <div className="my-works-tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={tab === item.value}
            className={tab === item.value ? 'active' : ''}
            onClick={() => onSwitchTab(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
