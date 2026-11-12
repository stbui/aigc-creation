import { Button } from './components';

/** 「加载更多」按钮：没有剩余项时不渲染 */
export function LibraryLoadMore({ remaining, onClick }: { remaining: number; onClick: () => void }) {
  if (remaining <= 0) return null;
  return (
    <Button type="text" className="asset-library-load-more" onClick={onClick}>
      加载更多（剩余 {remaining} 个）
    </Button>
  );
}
