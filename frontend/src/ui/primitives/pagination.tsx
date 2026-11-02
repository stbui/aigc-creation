import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';

export interface PaginationProps {
  current?: number;
  pageSize?: number;
  total?: number;
  onChange?: (page: number, pageSize: number) => void;
  showSizeChanger?: boolean;
  simple?: boolean;
  hideOnSinglePage?: boolean;
  size?: 'small' | 'default' | 'middle' | 'large';
  className?: string;
}

/** antd Pagination 的兼容壳：保留 current / pageSize / total 语义。 */
export function Pagination({
  current = 1,
  pageSize = 20,
  total = 0,
  onChange,
  showSizeChanger: _showSizeChanger,
  simple,
  hideOnSinglePage,
  className,
}: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safeCurrent = Math.min(Math.max(1, current), pages);
  if (hideOnSinglePage && pages <= 1) return null;

  return (
    <nav className={cn('ui-pagination', simple && 'is-simple', className)} aria-label="分页">
      <button
        type="button"
        className="ui-pagination-btn"
        aria-label="上一页"
        disabled={safeCurrent <= 1}
        onClick={() => onChange?.(safeCurrent - 1, pageSize)}
      >
        <ChevronLeft size={14} />
      </button>
      {simple ? (
        <span className="ui-pagination-status">
          {safeCurrent} / {pages}
        </span>
      ) : (
        <span className="ui-pagination-status">
          第 {safeCurrent} / {pages} 页
        </span>
      )}
      <button
        type="button"
        className="ui-pagination-btn"
        aria-label="下一页"
        disabled={safeCurrent >= pages}
        onClick={() => onChange?.(safeCurrent + 1, pageSize)}
      >
        <ChevronRight size={14} />
      </button>
    </nav>
  );
}
