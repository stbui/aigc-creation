import { Fragment, useMemo, type ReactNode } from 'react';
import {
  FlexRender,
  columnVisibilityFeature,
  createColumnHelper,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnVisibilityState,
  type OnChangeFn,
  type PaginationState,
  type RowData,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import { cn } from '../lib/cn';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import {
  Pagination as PaginationRoot,
  PaginationContent,
  PaginationItem,
} from '../components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
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
 * 后台数据表格（TanStack Table v9）。
 *
 * ## 这里决定了什么
 *
 * 排序、批量勾选上限、固定操作列、行展开、分页、密度 —— 后台 33 个页面里
 * 二十多个都要这几样，各写一份必然分叉（「批量勾选上限 100」这类硬约束
 * 一旦某个页面漏了，后端就会拒）。所以只有这一份实现。
 *
 * ## 状态归调用方，表格只负责投影
 *
 * 排序、分页、勾选都是**服务端驱动**的：`sort` / `pagination` / `selected`
 * 由页面持有并回传后端，表格从不自己改数据顺序或切片。因此三个特性全部按
 * `manualSorting` / `manualPagination` / 受控 selection 接入 —— TanStack 只
 * 提供列定义、表头分组与行级 API，不接管数据管线。谁把 `manual*` 关掉，
 * 就会变成「前端按当前页再排一次」，排序结果与后端分页对不上。
 *
 * 勾选状态在表格内部是 `RowSelectionState`（`key → true`），对外仍是
 * `string[]`：跨页勾选要保序、上限要卡在 `SELECT_LIMIT`，这两条只有用数组
 * 才表达得清楚。
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
  /**
   * 隐藏的列（按列 key）。传了才生效 —— 表头与表体共用同一份可见列集，
   * 不会出现「表头少一列、表体多一列」。
   */
  hiddenColumns?: string[];
}

/** 批量上限。与后端 `common/batch.ts` 的 MAX_BATCH 对齐，超出直接拒绝。 */
const SELECT_LIMIT = 100;

const ALIGN_CLASS = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
} as const;

/**
 * 只注册真正用到的特性。v9 按特性摇树，没注册的 API 与状态切片不进包；
 * 这里刻意不注册任何 row model —— 数据顺序与切片都由后端决定。
 *
 * `columnVisibilityFeature` 必须注册：列显隐是表格的基础语义（表头与表体
 * 必须显示同一批列），而 `row.getVisibleCells()` 只有在该特性注册后才存在。
 * 不注册时表体会用 `getAllCells()` 渲染**全部**叶子列，与表头的可见列集不一致 ——
 * 一旦将来任何地方按 `columnVisibility` 过滤表头，就会出现「表头少一列、表体多一列」。
 */
const TABLE_FEATURES = tableFeatures({
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
});

type AdminTableFeatures = typeof TABLE_FEATURES;

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
  hiddenColumns,
}: AdminDataTableProps<T>) {
  // hook 必须无条件调用，不能写在 `??` 右边
  const shellDensity = useDensity();
  const density = densityProp ?? shellDensity;
  const cellY = density === 'compact' ? 'py-1.5' : 'py-2.5';
  /* 行高由密度决定，不是由内容撑开 —— 否则换行的那行会明显更高 */
  const rowH = density === 'compact' ? 'h-9' : 'h-11';

  const [sortField, sortDir] = parseSort(sort);
  const sorting = useMemo<SortingState>(
    () => (sortField ? [{ id: sortField, desc: sortDir === 'desc' }] : []),
    [sortField, sortDir],
  );
  const rowSelection = useMemo<RowSelectionState>(
    () => Object.fromEntries(selected.map((key) => [key, true])),
    [selected],
  );
  const paginationState = useMemo<PaginationState>(
    () => ({
      pageIndex: Math.max(0, (pagination?.current ?? 1) - 1),
      pageSize: pagination?.pageSize ?? 20,
    }),
    [pagination?.current, pagination?.pageSize],
  );
  /** 隐藏列：默认全可见；调用方传 key 列表才隐藏 */
  const columnVisibility = useMemo<ColumnVisibilityState>(() => {
    const hidden = new Set(hiddenColumns ?? []);
    const result: ColumnVisibilityState = {};
    for (const column of columns) {
      if (hidden.has(column.key)) result[column.key] = false;
    }
    return result;
  }, [columns, hiddenColumns]);

  const columnByKey = useMemo(
    () => new Map(columns.map((column) => [column.key, column])),
    [columns],
  );

  const columnDefs = useMemo<Array<ColumnDef<AdminTableFeatures, RowData>>>(() => {
    const helper = createColumnHelper<AdminTableFeatures, RowData>();
    return columns.map((column) =>
      helper.accessor((row: RowData) => (row as Record<string, unknown>)[column.key], {
        id: column.key,
        // 排序字段回传后端，因此只需要 accessor 让列「可排序」，值本身不参与比较
        enableSorting: Boolean(column.sortable && onSortChange),
        header: ({ column: headerColumn }) => {
          const active = headerColumn.getIsSorted();
          if (!column.sortable || !onSortChange) return column.title;
          return (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={headerColumn.getToggleSortingHandler()}
              className={cn(
                '-ml-2 h-7 gap-1 px-2 text-xs font-semibold',
                active && 'text-foreground',
              )}
            >
              {column.title}
              {active === 'asc' ? (
                <ArrowUp className="size-3" aria-hidden />
              ) : active === 'desc' ? (
                <ArrowDown className="size-3" aria-hidden />
              ) : (
                <ChevronsUpDown className="size-3 text-muted-foreground/60" aria-hidden />
              )}
            </Button>
          );
        },
        cell: ({ row }) =>
          column.render
            ? column.render(row.original as T, row.index)
            : ((row.original as Record<string, unknown>)[column.key] as ReactNode),
      }),
    );
  }, [columns, onSortChange]);

  /** 排序回传：单列循环 desc → asc → 取消，与后端 `field:dir` 契约同形 */
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    if (!onSortChange) return;
    const next = typeof updater === 'function' ? updater(sorting) : updater;
    const first = next[0];
    onSortChange(first ? `${first.id}:${first.desc ? 'desc' : 'asc'}` : null);
  };

  const handlePaginationChange: OnChangeFn<PaginationState> = (updater) => {
    if (!pagination) return;
    const next = typeof updater === 'function' ? updater(paginationState) : updater;
    pagination.onChange(next.pageIndex + 1, next.pageSize);
  };

  /**
   * 勾选回传：保留既有顺序，新增项按当前页行序追加，总数卡在 `SELECT_LIMIT`。
   * 用数组而不是直接回传 `RowSelectionState`，是因为跨页勾选的顺序要稳定。
   */
  const handleRowSelectionChange: OnChangeFn<RowSelectionState> = (updater) => {
    if (!onSelectedChange) return;
    const next = typeof updater === 'function' ? updater(rowSelection) : updater;
    const keys = selected.filter((key) => next[key]);
    for (const row of rows) {
      const key = rowKey(row);
      if (!next[key] || keys.includes(key)) continue;
      if (keys.length >= SELECT_LIMIT) break;
      keys.push(key);
    }
    onSelectedChange(keys);
  };

  const table = useTable({
    features: TABLE_FEATURES,
    data: rows as unknown as RowData[],
    columns: columnDefs,
    getRowId: (row) => rowKey(row as unknown as T),
    state: { sorting, pagination: paginationState, rowSelection, columnVisibility },
    manualSorting: true,
    manualPagination: true,
    rowCount: pagination?.total ?? rows.length,
    autoResetPageIndex: false,
    enableMultiSort: false,
    sortDescFirst: true,
    enableRowSelection: selectable
      ? (row) => (isRowSelectable ? isRowSelectable(row.original as unknown as T) : true)
      : false,
    onSortingChange: handleSortingChange,
    onPaginationChange: handlePaginationChange,
    onRowSelectionChange: handleRowSelectionChange,
  });

  const visibleColumns = useMemo(
    () => columns.filter((column) => columnVisibility[column.key] !== false),
    [columns, columnVisibility],
  );

  if (loading && rows.length === 0) {
    return (
      <TableSkeleton
        rows={6}
        columns={visibleColumns as AdminColumn<unknown>[]}
        selectable={selectable}
        minWidth={minWidth}
        fixedLayout={fixedLayout}
        rowH={rowH}
      />
    );
  }

  if (error && rows.length === 0) {
    return <ListError error={error} onRetry={onRetry} />;
  }

  if (!loading && rows.length === 0) {
    return <EmptyState title={emptyText} action={emptyAction} />;
  }

  const selectableKeys = table
    .getRowModel()
    .rows.filter((row) => row.getCanSelect())
    .map((row) => row.id);
  const allSelected = table.getIsAllPageRowsSelected();
  const someSelected = !allSelected && table.getIsSomePageRowsSelected();

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
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-border hover:bg-transparent">
                {selectable && (
                  <TableHead className="w-9 px-2 py-2">
                    <Checkbox
                      aria-label={allSelected ? '取消选择本页全部' : '选择本页全部'}
                      checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                      disabled={selectableKeys.length === 0}
                      onCheckedChange={() => table.toggleAllPageRowsSelected()}
                    />
                  </TableHead>
                )}
                {headerGroup.headers.map((header) => {
                  const column = columnByKey.get(header.column.id);
                  if (!column) return null;
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      scope="col"
                      style={column.width ? { width: column.width } : undefined}
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : undefined
                      }
                      className={cn(
                        'h-9 whitespace-nowrap bg-muted/40 px-3 text-xs font-semibold text-foreground',
                        ALIGN_CLASS[column.align ?? 'left'],
                        column.fixed === 'right' && 'sticky right-0 bg-muted',
                      )}
                    >
                      {header.isPlaceholder ? null : <FlexRender header={header} />}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => {
              const key = row.id;
              const original = row.original as unknown as T;
              const checked = row.getIsSelected();
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
                      rowClassName?.(original),
                    )}
                    onClick={
                      onRowClick
                        ? (event) => {
                            // 勾选框与操作列里的按钮不该触发「打开详情」
                            const target = event.target as HTMLElement;
                            if (target.closest('button, a, input, label')) return;
                            onRowClick(original);
                          }
                        : undefined
                    }
                  >
                    {selectable && (
                      <TableCell className="px-2" onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          aria-label={rowSelectLabel?.(original) ?? '选择此行'}
                          checked={checked}
                          disabled={!row.getCanSelect()}
                          onCheckedChange={() => row.toggleSelected()}
                        />
                      </TableCell>
                    )}
                    {/* 表头与表体共用同一份可见列集（columnVisibilityFeature）：
                        表头走 getVisibleLeafColumns，表体走 getVisibleCells，
                        两边永远一致，不会出现「表头少一列、表体多一列」。 */}
                    {row.getVisibleCells().map((cell) => {
                      const column = columnByKey.get(cell.column.id);
                      if (!column) return null;
                      return (
                        <TableCell
                          key={cell.id}
                          title={column.cellTitle?.(original)}
                          className={cn(
                            'px-3 align-middle text-foreground',
                            cellY,
                            ALIGN_CLASS[column.align ?? 'left'],
                            column.fixed === 'right' && 'sticky right-0 bg-card',
                          )}
                        >
                          <FlexRender cell={cell} />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                  {isExpanded && renderExpanded && (
                    <TableRow data-testid="admin-table-expanded" className="border-border/70">
                      <TableCell
                        colSpan={visibleColumns.length + (selectable ? 1 : 0)}
                        className="bg-muted/40 px-3 py-3"
                      >
                        {renderExpanded(original)}
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
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              每页
              {/*
               * 用 shadcn `Select` 而不是原生 `<select>`：原生控件的下拉面板
               * 由浏览器绘制，深色模式与圆角/间距都不受项目令牌控制，与紧邻的
               * 分页按钮拼在一起风格割裂。
               */}
              <Select
                value={String(pagination.pageSize)}
                onValueChange={(next) => pagination.onChange(1, Number(next))}
              >
                <SelectTrigger size="sm" aria-label="每页条数" className="h-7 w-[68px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {[20, 50, 100].map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <PaginationRoot className="mx-0 w-auto justify-start" aria-label="分页">
              <PaginationContent className="gap-2">
                <PaginationItem>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={!table.getCanPreviousPage()}
                    onClick={() => table.previousPage()}
                  >
                    上一页
                  </Button>
                </PaginationItem>
                <PaginationItem>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {Math.min(pagination.current, totalPages)} / {totalPages}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={!table.getCanNextPage()}
                    onClick={() => table.nextPage()}
                  >
                    下一页
                  </Button>
                </PaginationItem>
              </PaginationContent>
            </PaginationRoot>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 首屏骨架：**用真实表格骨架**，不是几根等宽灰条。
 *
 * 之前的做法是 flex 行 + 等宽 `flex-1` 灰条，与真实表格的列宽毫无关系 ——
 * 数据到位时表格按 `AdminColumn.width` 重排，页面会横向跳一下，列宽大的
 * 表（模型清单、调用记录）跳得最明显。改用同一套 `Table` 骨架后，列宽由
 * 浏览器按同一份 `width` 计算，切换时宽度一致。
 */
function TableSkeleton({
  rows,
  columns,
  selectable,
  minWidth,
  fixedLayout,
  rowH,
}: {
  rows: number;
  columns: AdminColumn<unknown>[];
  selectable: boolean;
  minWidth?: number;
  fixedLayout: boolean;
  rowH: string;
}) {
  return (
    <div className="py-3" data-testid="admin-page-loading">
      <div data-testid="admin-table-scroll" className="relative overflow-x-auto">
        <Table
          className={cn('text-[13px]', fixedLayout && 'table-fixed')}
          style={minWidth ? { minWidth } : undefined}
        >
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              {selectable && (
                <TableHead className="w-9 px-2 py-2">
                  <Skeleton className="size-3.5" />
                </TableHead>
              )}
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={cn(
                    'h-9 whitespace-nowrap bg-muted/40 px-3 text-xs font-semibold text-foreground',
                    ALIGN_CLASS[column.align ?? 'left'],
                    column.fixed === 'right' && 'sticky right-0 bg-muted',
                  )}
                >
                  <Skeleton className="h-3" style={{ width: '60%' }} />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <TableRow
                key={rowIndex}
                className={cn('border-border/70 hover:bg-transparent', rowH)}
              >
                {selectable && (
                  <TableCell className="px-2">
                    <Skeleton className="size-3.5" />
                  </TableCell>
                )}
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    className={cn(
                      'px-3 align-middle',
                      column.fixed === 'right' && 'sticky right-0 bg-card',
                    )}
                  >
                    <Skeleton className="h-3.5" style={{ width: '70%' }} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
