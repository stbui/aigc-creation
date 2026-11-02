import { Fragment, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import { cn } from '../lib/cn';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Skeleton } from '../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { useDensity, type Density } from '../lib/density';
import { EmptyState, ListError } from './layout';

/**
 * 后台数据表格。
 *
 * ## 这里决定了什么
 *
 * 排序、批量勾选上限、固定操作列、行展开、分页、密度 —— 后台 34 个页面里
 * 二十多个都要这几样，各写一份必然分叉（「批量勾选上限 100」这类硬约束
 * 一旦某个页面漏了，后端就会拒）。所以只有这一份实现。
 *
 * ## 三态
 *
 * 首次加载无数据 → 骨架；失败且无数据 → 失败态 + 重试；空数据 → 空态。
 * **已有数据时**加载只在表体上叠一层淡化，不让整张表消失再出现。
 */

export interface AdminColumn<T> {
  /** 列标识，同时作为排序字段回传给后端 */
  key: string;
  title: ReactNode;
  width?: number;
  align?: 'left' | 'right' | 'center';
  render?: (row: T, index: number) => ReactNode;
  sortable?: boolean;
  fixed?: 'right';
  cellTitle?: (row: T) => string | undefined;
}

export interface AdminDataTableProps<T> {
  rows: T[];
  columns: Array<AdminColumn<T>>;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyText?: string;
  emptyAction?: ReactNode;
  /** `field:asc` / `field:desc`；与后端排序参数同形 */
  sort?: string | null;
  onSortChange?: (sort: string | null) => void;
  selectable?: boolean;
  selected?: string[];
  onSelectedChange?: (keys: string[]) => void;
  isRowSelectable?: (row: T) => boolean;
  rowSelectLabel?: (row: T) => string;
  pagination?: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number, pageSize: number) => void;
    unit?: string;
  };
  minWidth?: number;
  fixedLayout?: boolean;
  density?: Density;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  renderExpanded?: (row: T) => ReactNode;
  expandedKeys?: string[];
  onExpandedChange?: (keys: string[]) => void;
}

/** 批量上限。与后端 `common/batch.ts` 的 MAX_BATCH 对齐，超出直接拒绝。 */
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
  rowSelectLabel,
  pagination,
  minWidth,
  fixedLayout = false,
  density: densityProp,
  onRowClick,
  rowClassName,
  renderExpanded,
  expandedKeys = [],
  onExpandedChange,
}: AdminDataTableProps<T>) {
  const [sortField, sortDir] = parseSort(sort);
  // hook 必须无条件调用，不能写在 `??` 右边
  const shellDensity = useDensity();
  const density = densityProp ?? shellDensity;
  const cellY = density === 'compact' ? 'py-1.5' : 'py-2.5';
  /* 行高由密度决定，不是由内容撑开 —— 否则换行的那行会明显更高 */
  const rowH = density === 'compact' ? 'h-9' : 'h-11';

  if (loading && rows.length === 0) {
    return <TableSkeleton rows={6} columns={columns.length + (selectable ? 1 : 0)} />;
  }

  if (error && rows.length === 0) {
    return <ListError error={error} onRetry={onRetry} />;
  }

  if (!loading && rows.length === 0) {
    return <EmptyState title={emptyText} action={emptyAction} />;
  }

  const selectableRows = selectable
    ? rows.filter((row) => (isRowSelectable ? isRowSelectable(row) : true))
    : [];
  const selectableKeys = selectableRows.map(rowKey);
  const allSelected =
    selectableKeys.length > 0 && selectableKeys.every((key) => selected.includes(key));
  const someSelected =
    !allSelected && selectableKeys.some((key) => selected.includes(key));

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

  const totalPages = pagination
    ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize))
    : 1;

  return (
    <div className="flex flex-col">
      <div
        data-testid="admin-table-scroll"
        className={cn('relative overflow-x-auto', loading && rows.length > 0 && 'opacity-60')}
      >
        <Table
          data-testid="admin-table"
          className={cn('text-[13px]', fixedLayout && 'table-fixed')}
          style={minWidth ? { minWidth } : undefined}
        >
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              {selectable && (
                <TableHead className="w-9 px-2 py-2">
                  <Checkbox
                    aria-label={allSelected ? '取消选择本页全部' : '选择本页全部'}
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    disabled={selectableKeys.length === 0}
                    onCheckedChange={toggleAll}
                  />
                </TableHead>
              )}
              {columns.map((column) => {
                const active = sortField === column.key;
                return (
                  <TableHead
                    key={column.key}
                    scope="col"
                    style={column.width ? { width: column.width } : undefined}
                    aria-sort={
                      active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                    className={cn(
                      'h-9 whitespace-nowrap bg-muted/40 px-3 text-xs font-medium text-muted-foreground',
                      ALIGN_CLASS[column.align ?? 'left'],
                      column.fixed === 'right' && 'sticky right-0 bg-muted',
                    )}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground',
                          active && 'text-foreground',
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
                          <ChevronsUpDown className="size-3 text-muted-foreground/60" aria-hidden />
                        )}
                      </button>
                    ) : (
                      column.title
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => {
              const key = rowKey(row);
              const checked = selected.includes(key);
              const canSelect = selectable && (isRowSelectable ? isRowSelectable(row) : true);
              const isExpanded = expandedKeys.includes(key);
              return (
                <Fragment key={key}>
                  <TableRow
                    data-testid="admin-table-row"
                    data-row-key={key}
                    data-state={checked ? 'selected' : undefined}
                    className={cn(
                      'border-border/70 transition-colors hover:bg-muted/50',
                      rowH,
                      checked && 'bg-accent/40',
                      onRowClick && 'cursor-pointer',
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
                      <TableCell className="px-2" onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          aria-label={rowSelectLabel?.(row) ?? '选择此行'}
                          checked={checked}
                          disabled={!canSelect}
                          onCheckedChange={() => toggleOne(key)}
                        />
                      </TableCell>
                    )}
                    {columns.map((column) => (
                      <TableCell
                        key={column.key}
                        title={column.cellTitle?.(row)}
                        className={cn(
                          'px-3 align-middle text-foreground',
                          cellY,
                          ALIGN_CLASS[column.align ?? 'left'],
                          column.fixed === 'right' && 'sticky right-0 bg-card',
                        )}
                      >
                        {column.render
                          ? column.render(row, index)
                          : ((row as Record<string, unknown>)[column.key] as ReactNode)}
                      </TableCell>
                    ))}
                  </TableRow>
                  {isExpanded && renderExpanded && (
                    <TableRow data-testid="admin-table-expanded" className="border-border/70">
                      <TableCell
                        colSpan={columns.length + (selectable ? 1 : 0)}
                        className="bg-muted/40 px-3 py-3"
                      >
                        {renderExpanded(row)}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {selectable && onSelectedChange && selected.length > 0 && (
        <p className="px-1 pt-2 text-xs text-muted-foreground">
          已选 {selected.length} 条
          {selected.length >= SELECT_LIMIT && `（批量操作上限 ${SELECT_LIMIT} 条）`}
        </p>
      )}

      {pagination && pagination.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-1 pt-3">
          <span className="text-xs text-muted-foreground">
            共 {pagination.total} {pagination.unit ?? '条'}
          </span>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              每页
              <select
                className="h-7 rounded-md border border-input bg-background px-1.5 text-xs text-foreground"
                value={pagination.pageSize}
                onChange={(event) => pagination.onChange(1, Number(event.target.value))}
              >
                {[20, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <nav aria-label="分页" className="flex items-center gap-2">
              <Button
                variant="outline"
                size="xs"
                disabled={pagination.current <= 1}
                onClick={() =>
                  pagination.onChange(
                    Math.min(pagination.current, totalPages) - 1,
                    pagination.pageSize,
                  )
                }
              >
                上一页
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                {Math.min(pagination.current, totalPages)} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="xs"
                disabled={pagination.current >= totalPages}
                onClick={() =>
                  pagination.onChange(
                    Math.min(pagination.current, totalPages) + 1,
                    pagination.pageSize,
                  )
                }
              >
                下一页
              </Button>
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}

/** 首屏骨架：列数对齐真实表头，切换后不会出现宽度跳动。 */
function TableSkeleton({ rows, columns }: { rows: number; columns: number }) {
  return (
    <div className="py-3" data-testid="admin-page-loading">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="flex gap-3">
            {Array.from({ length: Math.max(columns, 1) }).map((_, cellIndex) => (
              <Skeleton
                key={cellIndex}
                className={cn('h-8 flex-1', cellIndex === 0 && 'max-w-[220px]')}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">加载中…</p>
    </div>
  );
}

/** `field:asc` → `[field, dir]`；无法解析时视为未排序。 */
function parseSort(sort: string | null): [string | null, 'asc' | 'desc'] {
  if (!sort) return [null, 'desc'];
  const [field, dir] = sort.split(':');
  return [field || null, dir === 'asc' ? 'asc' : 'desc'];
}
