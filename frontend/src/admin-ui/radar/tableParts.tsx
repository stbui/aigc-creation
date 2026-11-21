/**
 * 数据表格的零件：对齐枚举、首屏骨架、分页条、排序串解析。
 *
 * 从 `table.tsx` 拆出 —— 表格本体已经是「状态投影 + 行渲染」的长函数，
 * 骨架与分页条只是同一份列定义的两处投影，放在一起读不动。
 */
import { Button } from '../components/ui/button';
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
import { cn } from '../lib/cn';
import type { AdminColumn } from './table';

/** 列对齐：表头与表体共用。 */
export const ALIGN_CLASS = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
} as const;

/** 分页契约；`AdminDataTable` 直接把它挂到 `pagination` 属性上。 */
export interface AdminPagination {
  current: number;
  pageSize: number;
  total: number;
  onChange: (page: number, pageSize: number) => void;
  unit?: string;
}

/** `field:asc` → `[field, dir]`；无法解析时视为未排序。 */
export function parseSort(sort: string | null): [string | null, 'asc' | 'desc'] {
  if (!sort) return [null, 'desc'];
  const [field, dir] = sort.split(':');
  return [field || null, dir === 'asc' ? 'asc' : 'desc'];
}

/**
 * 首屏骨架：**用真实表格骨架**，不是几根等宽灰条。
 *
 * 之前的做法是 flex 行 + 等宽 `flex-1` 灰条，与真实表格的列宽毫无关系 ——
 * 数据到位时表格按 `AdminColumn.width` 重排，页面会横向跳一下，列宽大的
 * 表（模型清单、调用记录）跳得最明显。改用同一套 `Table` 骨架后，列宽由
 * 浏览器按同一份 `width` 计算，切换时宽度一致。
 */
export function TableSkeleton({
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
                    'h-9 whitespace-nowrap bg-muted/40 px-3 text-[13px] font-semibold text-foreground',
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
              <TableRow key={rowIndex} className={cn('border-border/70 hover:bg-transparent', rowH)}>
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

/** 分页条：总数 + 每页条数 + 上一页 / 下一页。翻页动作由调用方回传后端。 */
export function TablePager({
  pagination,
  totalPages,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
}: {
  pagination: AdminPagination;
  totalPages: number;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
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
            <SelectTrigger size="sm" aria-label="每页条数" className="w-[68px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="admin-portal radar-scope rounded-[8px] border-radar-ink-200 bg-radar-surface shadow-none [&_[data-slot=select-item]]:text-[13px]">
              <SelectGroup>
                {[20, 50, 100].map((size) => (
                  <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <PaginationRoot className="mx-0 w-auto justify-start" aria-label="分页">
          <PaginationContent className="gap-2">
            <PaginationItem>
              <Button variant="outline" size="sm" disabled={!canPrevious} onClick={onPrevious}>
                上一页
              </Button>
            </PaginationItem>
            <PaginationItem>
              <span className="text-xs text-muted-foreground tabular-nums">
                {Math.min(pagination.current, totalPages)} / {totalPages}
              </span>
            </PaginationItem>
            <PaginationItem>
              <Button variant="outline" size="sm" disabled={!canNext} onClick={onNext}>
                下一页
              </Button>
            </PaginationItem>
          </PaginationContent>
        </PaginationRoot>
      </div>
    </div>
  );
}
