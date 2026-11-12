import { ChevronDown } from 'lucide-react';

/** 「加载更多」按钮：先铺满本地已加载列表，本地铺完后再请求下一页 */
export interface WorksLoadMoreProps {
  loading: boolean;
  /** 本地剩余 + 服务端尚未加载的条数 */
  remaining: number;
  onClick: () => void;
}

export function WorksLoadMore({ loading, remaining, onClick }: WorksLoadMoreProps) {
  return (
    <button type="button" className="my-works-load-more" disabled={loading} onClick={onClick}>
      <ChevronDown size={14} />
      {loading ? '加载中…' : `加载更多（还有 ${remaining} 个）`}
    </button>
  );
}
