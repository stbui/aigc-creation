import { Button } from './components';

/** 「加载更多」按钮：没有剩余项时不渲染 */
export interface LibraryLoadMoreProps {
  remaining: number;
  onClick: () => void;
}

export function LibraryLoadMore({ remaining, onClick }: LibraryLoadMoreProps) {
  if (remaining <= 0) return null;
  return (
    <Button
      variant="ghost"
      className="mt-2 flex min-h-[52px] w-full items-center justify-center gap-2 text-xs text-muted-foreground hover:text-brand-hover"
      onClick={onClick}
    >
      加载更多（剩余 {remaining} 个）
    </Button>
  );
}
