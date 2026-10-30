import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, RotateCcw } from 'lucide-react';
import { Button } from '../../vendor/boardui/components/base/buttons/button';
import { Pagination } from '../../vendor/boardui/components/base/pagination/pagination';
import { cx } from '../lib/cn';
import { EmptyState, Result, Skeleton } from './index';

/**
 * 后台数据表（BoardUI）。
 *
 * ## 为什么不直接用 BoardUI 的 `data-table`
 *
 * vendor 里的 `DataTable` 是 TanStack 驱动的**客户端**表格：排序、筛选、分页
 * 都在浏览器里完成。后台 29 张表全部是**服务端**的 —— 一页 20 条，排序与
 * 筛选都带在请求参数上，客户端再排一次只会与后端结果打架。所以这里只借
 * BoardUI 的视觉语言（发丝线、密度、行悬停、pin 到右侧的操作列），数据流
 * 保持服务端原样。
 *
 * ## 必须保住的行为
 *
 * - 批量选择上限 100（后端 `ids ≤ 100`），超出时给出可读提示而不是静默截断；
 * - 排序只回传 `field:asc|desc` 字符串，由页面交给 `useAdminList` 重新请求；
 * - 加载失败且已有数据时保留旧数据（与 `useAdminList` 的「失败不清空」一致）；
 * - 空态写明「为什么空」，不留一片白；
 * - 操作列固定右侧，横向滚动时仍可点。
 */
export interface AdminColumn<T> {
  /** 列标识，同时作为排序字段回传给后端 */
  key: string;
  title: ReactNode;
  width?: number;
  align?: 'left' | 'right' | 'center';
  render?: (row: T, index: number) => ReactNode;
  /** 该列可否排序 */
  sortable?: boolean;
  /** 固定到右侧（操作列） */
  fixed?: 'right';
  /** 单元格标题属性，用于截断文本的悬停提示 */
  title?: (row: T) => string | undefined;
}

export interface AdminDataTableProps<T> {
  rows: T[];
  columns: Array<AdminColumn<T>>;
  rowKey: (row: T) => string;
  /** 表体骨架；首屏无数据时才整块替换，已有数据时只做淡化 */
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** 空态文案，说明「为什么空」 */
  emptyText?: string;
  emptyAction?: ReactNode;
  /** 当前排序，形如 `createdAt:desc` */
  sort?: string | null;
  onSortChange?: (sort: string | null) => void;
  selectable?: boolean;
  selected?: string[];
  onSelectedChange?: (keys: string[]) => void;
  /** 逐行判断是否可选（如已注销账号不可改状态） */
  isRowSelectable?: (row: T) => boolean;
  pagination?: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number, pageSize: number) => void;
    /** 计量词，默认「条」 */
    unit?: string;
  };
  /** 横向滚动的最小宽度，列多时给出 */
  minWidth?: number;
  density?: 'comfortable' | 'compact';
  onRowClick?: (row: T) => void;
  /** 行附加类名（如高亮异常行） */
  rowClassName?: (row: T) => string | undefined;
}

/** 批量上限。与后端 `common/batch.ts` 的 MAX_BATCH 对齐，超出直接拒绝 */
const SELECT_LIMIT = 100;

const ALIGN_CLASS = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
} as const;

export function AdminDataTable<T>({
  rows,
  columns,
  rowKey,
  loading = false,
  error = null,
  onRetry,
  emptyText = '暂无数据',
  emptyAction,
  sort = null,
  onSortChange,
  selectable = false,
  selected = [],
  onSelectedChange,
  isRowSelectable,
  pagination,
  minWidth,
  density = 'comfortable',
  onRowClick,
  rowClassName,
}: AdminDataTableProps<T>) {
  const [sortField, sortDir] = parseSort(sort);
  const rowH = density === 'compact' ? 'h-9' : 'h-11';
  const cellY = density === 'compact' ? 'py-1.5' : 'py-2.5';

  // 首次加载没有数据：整块骨架。已有数据时只在表体上叠一层淡化，
  // 避免翻页/刷新时整张表消失再出现。
  if (loading && rows.length === 0) {
    return (
      <div className="py-3">
        <Skeleton rows={6} />
        <p className="mt-2 text-center text-xs text-text-tertiary">加载中…</p>
      </div>
    );
  }

  if (error && rows.length === 0) {
    return (
      <Result
        tone="error"
        title="加载失败"
        description={error}
        actions={
          onRetry && (
            <Button variant="secondary" size="small" leadingIcon={RotateCcw} onClick={onRetry}>
              重试
            </Button>
          )
        }
      />
    );
  }

  if (!loading && rows.length === 0) {
    return <EmptyState title={emptyText} action={emptyAction} />;
  }

  const selectableRows = selectable
    ? rows.filter((row) => (isRowSelectable ? isRowSelectable(row) : true))
    : [];
  const selectableKeys = selectableRows.map(rowKey);
  const allSelected = selectableKeys.length > 0 && selectableKeys.every((key) => selected.includes(key));
  const someSelected = !allSelected && selectableKeys.some((key) => selected.includes(key));

  const toggleAll = () => {
    if (!onSelectedChange) return;
    if (allSelected) {
      onSelectedChange(selected.filter((key) => !selectableKeys.includes(key)));
      return;
    }
    const merged = new Set(selected);
    for (const key of selectableKeys) {
      if (merged.size >= SELECT_LIMIT) break;
      merged.add(key);
    }
    onSelectedChange(Array.from(merged));
  };

  const toggleOne = (key: string) => {
    if (!onSelectedChange) return;
    if (selected.includes(key)) {
      onSelectedChange(selected.filter((item) => item !== key));
    } else if (selected.length < SELECT_LIMIT) {
      onSelectedChange([...selected, key]);
    }
  };

  const toggleSort = (column: AdminColumn<T>) => {
    if (!column.sortable || !onSortChange) return;
    if (sortField !== column.key) onSortChange(`${column.key}:desc`);
    else if (sortDir === 'desc') onSortChange(`${column.key}:asc`);
    else onSortChange(null);
  };

  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;

  return (
    <div className="flex flex-col">
      <div className={cx('relative overflow-x-auto', loading && rows.length > 0 && 'opacity-60')}>
        <table
          className="w-full border-collapse text-[13px]"
          style={minWidth ? { minWidth } : undefined}
        >
          <thead>
            <tr className="border-b border-border-table bg-background-secondary-default/60">
              {selectable && (
                <th className="w-9 px-2 py-2 text-left" scope="col">
                  <input
                    type="checkbox"
                    className="size-3.5 cursor-pointer accent-accent-600"
                    aria-label={allSelected ? '取消选择本页全部' : '选择本页全部'}
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    disabled={selectableKeys.length === 0}
                    onChange={toggleAll}
                  />
                </th>
              )}
              {columns.map((column) => {
                const active = sortField === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    style={column.width ? { width: column.width } : undefined}
                    aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cx(
                      'whitespace-nowrap px-3 py-2 text-xs font-medium text-text-secondary',
                      ALIGN_CLASS[column.align ?? 'left'],
                      column.fixed === 'right' && 'sticky right-0 bg-background-secondary-default',
                    )}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        className={cx(
                          'inline-flex items-center gap-1 rounded transition-colors hover:text-text-primary',
                          active && 'text-accent-700',
                        )}
                      >
                        {column.title}
                        {active ? (
                          sortDir === 'asc' ? (
                            <ArrowUp className="size-3" aria-hidden />
                          ) : (
                            <ArrowDown className="size-3" aria-hidden />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3 text-text-placeholder" aria-hidden />
                        )}
                      </button>
                    ) : (
                      column.title
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const key = rowKey(row);
              const checked = selected.includes(key);
              const canSelect = selectable && (isRowSelectable ? isRowSelectable(row) : true);
              return (
                <tr
                  key={key}
                  className={cx(
                    'border-b border-border-table/70 transition-colors',
                    rowH,
                    onRowClick && 'cursor-pointer',
                    'hover:bg-background-secondary-default/70',
                    checked && 'bg-accent-50/60',
                    rowClassName?.(row),
                  )}
                  onClick={
                    onRowClick
                      ? (event) => {
                          // 勾选框与操作列里的按钮不该触发「打开详情」
                          const target = event.target as HTMLElement;
                          if (target.closest('button, a, input, label')) return;
                          onRowClick(row);
                        }
                      : undefined
                  }
                >
                  {selectable && (
                    <td className="px-2" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="size-3.5 cursor-pointer accent-accent-600 disabled:cursor-not-allowed"
                        aria-label="选择此行"
                        checked={checked}
                        disabled={!canSelect}
                        onChange={() => toggleOne(key)}
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      title={column.title?.(row)}
                      className={cx(
                        'px-3 align-middle text-text-primary',
                        cellY,
                        ALIGN_CLASS[column.align ?? 'left'],
                        column.fixed === 'right' && 'sticky right-0 bg-white',
                      )}
                    >
                      {column.render ? column.render(row, index) : ((row as Record<string, unknown>)[column.key] as ReactNode)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectable && selected.length > 0 && (
        <p className="px-1 pt-2 text-xs text-text-tertiary">
          已选 {selected.length} 条
          {selected.length >= SELECT_LIMIT && `（批量操作上限 ${SELECT_LIMIT} 条）`}
        </p>
      )}

      {pagination && pagination.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-table px-1 pt-3">
          <span className="text-xs text-text-tertiary">
            共 {pagination.total} {pagination.unit ?? '条'}
          </span>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-text-tertiary">
              每页
              <select
                className="h-7 rounded-md border border-border-table bg-white px-1.5 text-xs text-text-secondary"
                value={pagination.pageSize}
                onChange={(event) =>
                  pagination.onChange(1, Number(event.target.value))
                }
              >
                {[20, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <Pagination
              page={Math.min(pagination.current, totalPages)}
              totalPages={totalPages}
              onChange={(page) => pagination.onChange(page, pagination.pageSize)}
              previousLabel="上一页"
              nextLabel="下一页"
              aria-label="分页"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** `field:asc` → `[field, dir]`；无法解析时视为未排序 */
function parseSort(sort: string | null): [string | null, 'asc' | 'desc'] {
  if (!sort) return [null, 'desc'];
  const [field, dir] = sort.split(':');
  return [field || null, dir === 'asc' ? 'asc' : 'desc'];
}
