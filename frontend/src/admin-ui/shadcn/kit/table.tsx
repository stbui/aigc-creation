import { Fragment, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Button, Checkbox, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui';
import { useDensity, type Density } from '../../lib/density';
import { AdminListError, EmptyState } from '../layout';
import { Skeleton } from './display';

/**
 * 数据表格（shadcn 版），与 `admin-ui/primitives/DataTable` 同签名。
 *
 * ## 为什么整份照搬而不是包一层
 *
 * 表格是后台最复杂的共享件：排序、批量勾选上限、固定操作列、行展开、
 * 分页与密度都由它决定，包一层只会多出一份「谁说了算」的分歧。这里保留
 * 原实现的**全部行为**（含 `SELECT_LIMIT=100`、`fixedLayout`、`cellTitle`），
 * 仅把渲染换成 shadcn `Table` 的标记与令牌。
 *
 * ## 骨架与空态不在这里重写
 *
 * 首屏无数据的骨架、空表、失败重试直接复用 `shadcn/layout` 的同名件 ——
 * 同一页里「表格空了」与「列表空了」应该是同一种观感。
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
  /* 行高由密度决定，不是由单元格内容撑开 —— 否则同一张表里换行的那行会明显更高 */
  const rowH = density === 'compact' ? 'h-9' : 'h-11';

  // 首次加载没有数据：整块骨架。已有数据时只在表体上叠一层淡化，
  // 避免翻页/刷新时整张表消失再出现。
  if (loading && rows.length === 0) {
    return (
      <div className="py-3">
        <Skeleton rows={6} />
        <p className="mt-2 text-center text-xs text-muted-foreground">加载中…</p>
      </div>
    );
  }

  if (error && rows.length === 0) {
    // 没有 `onRetry` 时不渲染重试按钮 —— 一个点了没反应的按钮比没有更糟
    return onRetry ? (
      <AdminListError error={error} onRetry={onRetry} />
    ) : (
      <div className="rounded-xl border border-border bg-card px-6 py-12 text-center shadow-card">
        <p className="text-sm font-medium text-foreground">加载失败</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{error}</p>
      </div>
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
                    aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
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
                          'inline-flex items-center gap-1 rounded transition-colors hover:text-foreground',
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

      {selectable && selected.length > 0 && (
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
                onClick={() => pagination.onChange(Math.min(pagination.current, totalPages) - 1, pagination.pageSize)}
              >
                上一页
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {Math.min(pagination.current, totalPages)} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="xs"
                disabled={pagination.current >= totalPages}
                onClick={() => pagination.onChange(Math.min(pagination.current, totalPages) + 1, pagination.pageSize)}
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

/** `field:asc` → `[field, dir]`；无法解析时视为未排序 */
function parseSort(sort: string | null): [string | null, 'asc' | 'desc'] {
  if (!sort) return [null, 'desc'];
  const [field, dir] = sort.split(':');
  return [field || null, dir === 'asc' ? 'asc' : 'desc'];
}
