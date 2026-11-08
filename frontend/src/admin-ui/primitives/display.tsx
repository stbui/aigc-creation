import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Lock, X } from 'lucide-react';

import { cn } from '../lib/cn';
import { Alert } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../components/ui/empty';
import {
  Pagination as PaginationRoot,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from '../components/ui/pagination';
import { Progress } from '../components/ui/progress';
import { STATUS_META, type TagTone } from '../../components/admin/statusMeta';
import { EmptyState } from './layout';

/** 状态语义色的取值集合，随 `StatusTag` 一起对外导出 */
export type { TagTone };

/**
 * 后台展示件：筛选条 / 状态标签 / 提示条 / 键值描述 / 骨架 / 分页。
 *
 * 这些件在 30 多个页面里反复出现，形态必须只有一份 —— 各页各写一套的话，
 * 「已筛选条件怎么回显」「状态色怎么对应」迟早两页不一致。
 */

/* ────────────────────────── 筛选条 ────────────────────────── */

/** 页头下方的筛选容器。里面的条件自然换行，动作靠 `FilterActions` 推到最右。 */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-testid="admin-filter"
      className={cn(
        'mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 shadow-card',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 筛选条右侧的动作区（查询 / 重置）。 */
export function FilterActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-testid="admin-filter-actions"
      className={cn('ml-auto flex shrink-0 items-center gap-2', className)}
    >
      {children}
    </div>
  );
}

export interface AppliedFilter {
  key: string;
  label: string;
  onClear?: () => void;
}

/**
 * 已生效筛选回显。
 *
 * `basis-full` 让它单独占一行：与「查询 / 重置」挤在一行时，按钮与回显会
 * 混成一串，用户分不清哪个是动作、哪个是状态。
 */
export function AppliedFilters({
  items,
  onClearAll,
}: {
  items: AppliedFilter[];
  onClearAll?: () => void;
}) {
  if (items.length === 0) return null;

  return (
    <div
      data-testid="admin-filter-chips"
      className="flex basis-full flex-wrap items-center gap-1.5 pt-0.5"
      aria-label="已生效的筛选条件"
    >
      <span className="text-xs text-muted-foreground">已筛选</span>
      {items.map((item) => (
        <Badge
          key={item.key}
          variant="secondary"
          data-testid="admin-filter-chip"
          data-filter-key={item.key}
          title={item.label}
          className="gap-1 overflow-visible rounded-md bg-accent px-1.5 py-0.5 text-xs font-normal text-accent-foreground"
        >
          <span className="max-w-[220px] truncate">{item.label}</span>
          {item.onClear && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`清除筛选：${item.label}`}
              onClick={item.onClear}
              className="size-4 rounded-sm p-0 text-accent-foreground/70 hover:bg-transparent hover:text-accent-foreground"
            >
              <X aria-hidden />
            </Button>
          )}
        </Badge>
      ))}
      {onClearAll && (
        <Button variant="ghost" size="xs" className="ml-1" onClick={onClearAll}>
          清除全部
        </Button>
      )}
    </div>
  );
}

/* ────────────────────────── 状态标签 ────────────────────────── */

const TAG_TONE_CLASS: Record<TagTone, string> = {
  success: 'bg-success-soft text-success-text',
  danger: 'bg-danger-soft text-danger-text',
  warn: 'bg-warn-soft text-warn-text',
  brand: 'bg-accent text-accent-foreground',
  muted: 'bg-muted text-muted-foreground',
};

/**
 * 状态标签。
 *
 * 文案与色调的单一事实源是 `components/admin/statusMeta.ts` 的 `STATUS_META`，
 * 这里只负责渲染，不复制那张表。未登记的状态回退原值 —— 「不认识的标签」
 * 比「没有标签」更容易被运维发现。
 */
export function StatusTag({
  status,
  label,
  tone,
  showDot = false,
}: {
  status: string;
  label?: string;
  tone?: TagTone;
  showDot?: boolean;
}) {
  const meta = STATUS_META[status] ?? { label: status, tone: 'muted' as TagTone };
  return (
    <Badge
      variant="secondary"
      data-status={status}
      className={cn(
        TAG_TONE_CLASS[tone ?? meta.tone],
      )}
    >
      {showDot && <span data-testid="status-dot" className="size-1.5 rounded-full bg-current" aria-hidden />}
      {label ?? meta.label}
    </Badge>
  );
}

/* ────────────────────────── 提示条 ────────────────────────── */

const NOTICE_META = {
  info: { Icon: Info, cls: 'border-transparent bg-accent text-accent-foreground' },
  success: {
    Icon: CheckCircle2,
    cls: 'border-success-border bg-success-soft text-success-text',
  },
  warn: { Icon: AlertTriangle, cls: 'border-warn-border bg-warn-soft text-warn-text' },
  danger: { Icon: AlertTriangle, cls: 'border-transparent bg-danger-soft text-danger-text' },
  locked: { Icon: Lock, cls: 'border-border bg-muted text-muted-foreground' },
} as const;

/**
 * 页面级提示条。
 *
 * `danger` 走 `role="alert"`，其余 `role="status"` —— 颜色不是唯一的严重性
 * 信号，读屏用户也要能听出「这条要马上处理」。
 */
export function Notice({
  tone = 'info',
  title,
  icon,
  children,
  className,
}: {
  tone?: 'info' | 'success' | 'warn' | 'danger' | 'locked';
  title?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const meta = NOTICE_META[tone];
  const rendered =
    icon === null ? null : (icon ?? <meta.Icon className="size-4 shrink-0" aria-hidden />);

  return (
    <Alert
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'mb-3 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs',
        meta.cls,
        className,
      )}
    >
      {rendered && <span className="mt-px shrink-0 [&_svg]:size-4">{rendered}</span>}
      <div className="min-w-0 flex-1 leading-5">
        {title && <div className="font-semibold">{title}</div>}
        {children}
      </div>
    </Alert>
  );
}

/* ────────────────────────── 比例条 ────────────────────────── */

/**
 * 比例条：展示「已用 / 总量」这类占比，**不表示任务进度**。
 *
 * 底色与轨道都用 `bg-muted`，指示条按 `tone` 取语义色 —— 页面上同一排比例条
 * 的色调不同，读的是同一套结论（正常品牌色 / 超限危险色），不能各页自己写渐变。
 */
export function Meter({
  value,
  tone = 'brand',
  className,
  label,
  decorative = false,
}: {
  /** 0–100，越界自动夹紧 */
  value: number;
  tone?: 'brand' | 'danger' | 'success' | 'warn';
  className?: string;
  /** 供读屏使用；数值本身已在旁边以文字给出时不要传 */
  label?: string;
  /** 纯装饰：旁边已有「7 / 100」这类可读文本时置为 true */
  decorative?: boolean;
}) {
  const indicator =
    tone === 'danger'
      ? '[&>[data-slot=progress-indicator]]:bg-danger-text'
      : tone === 'warn'
        ? '[&>[data-slot=progress-indicator]]:bg-warn-text'
        : tone === 'success'
          ? '[&>[data-slot=progress-indicator]]:bg-success-text'
          : '[&>[data-slot=progress-indicator]]:bg-brand';

  return (
    <Progress
      value={Math.max(0, Math.min(100, value))}
      aria-label={label}
      aria-hidden={decorative || undefined}
      className={cn(
        'h-2 gap-0 rounded-full bg-muted [&>[data-slot=progress-indicator]]:rounded-full',
        indicator,
        className,
      )}
    />
  );
}

/* ────────────────────────── 键值描述 ────────────────────────── */

/** 详情的信息层级靠「标签 / 值」两列，不靠卡片嵌套。 */
export function Descriptions({
  items,
  columns = 1,
}: {
  items: Array<{ label: ReactNode; value: ReactNode }>;
  columns?: 1 | 2 | 3;
}) {
  const colClass =
    columns === 3 ? 'sm:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : '';
  return (
    <dl data-testid="admin-desc" className={cn('grid grid-cols-1 gap-x-6 gap-y-3', colClass)}>
      {items.map((item, index) => (
        <div key={index} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 text-sm break-words text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ────────────────────────── 分页 ────────────────────────── */

/**
 * 页码型分页条。
 *
 * 只处理「上下页 + 页码窗口」：后台列表一次最多 100 行，页码窗口按
 * `siblingCount` 展开，超出用省略号收窄 —— 页码太多时逐个列出反而更慢。
 */
export function Pagination({
  page,
  totalPages,
  onChange,
  siblingCount = 1,
  className,
  previousLabel = '上一页',
  nextLabel = '下一页',
  'aria-label': ariaLabel = '分页',
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  siblingCount?: number;
  className?: string;
  previousLabel?: string;
  nextLabel?: string;
  'aria-label'?: string;
}) {
  const total = Math.max(1, totalPages);
  const current = Math.min(Math.max(1, page), total);
  const start = Math.max(1, current - siblingCount);
  const end = Math.min(total, current + siblingCount);
  const pages: number[] = [];
  for (let index = start; index <= end; index += 1) pages.push(index);

  return (
    <PaginationRoot
      className={cn('mx-0 w-auto justify-start', className)}
      aria-label={ariaLabel}
    >
      <PaginationContent className="gap-1">
        <PaginationItem>
          <Button
            variant="outline"
            size="xs"
            disabled={current <= 1}
            onClick={() => onChange(current - 1)}
          >
            <ChevronLeft aria-hidden />
            {previousLabel}
          </Button>
        </PaginationItem>

        {start > 1 && (
          <PaginationItem>
            <PageCell page={1} current={current} onChange={onChange} />
          </PaginationItem>
        )}
        {start > 2 && (
          <PaginationItem>
            <PaginationEllipsis className="size-6" />
          </PaginationItem>
        )}
        {pages.map((item) => (
          <PaginationItem key={item}>
            <PageCell page={item} current={current} onChange={onChange} />
          </PaginationItem>
        ))}
        {end < total - 1 && (
          <PaginationItem>
            <PaginationEllipsis className="size-6" />
          </PaginationItem>
        )}
        {end < total && (
          <PaginationItem>
            <PageCell page={total} current={current} onChange={onChange} />
          </PaginationItem>
        )}

        <PaginationItem>
          <Button
            variant="outline"
            size="xs"
            disabled={current >= total}
            onClick={() => onChange(current + 1)}
          >
            {nextLabel}
            <ChevronRight aria-hidden />
          </Button>
        </PaginationItem>
      </PaginationContent>
    </PaginationRoot>
  );
}

function PageCell({
  page,
  current,
  onChange,
}: {
  page: number;
  current: number;
  onChange: (page: number) => void;
}) {
  const active = page === current;
  return (
    <Button
      variant={active ? 'outline' : 'ghost'}
      size="icon-xs"
      aria-current={active ? 'page' : undefined}
      aria-label={`第 ${page} 页`}
      onClick={() => onChange(page)}
      className={cn('tabular-nums', active && 'font-medium')}
    >
      {page}
    </Button>
  );
}

/* ────────────────────────── 空态 ────────────────────────── */

/**
 * 带自定义图标的空态。
 *
 * 比 `layout.EmptyState` 多一个 `icon`：有些页面的空态其实是「成功的」，
 * 比如「今天没有新告警」，用信箱图标会让人以为出了错。
 */
export function EmptyHint({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  if (!icon) return <EmptyState title={title} description={description} action={action} />;
  return (
    <Empty className="gap-2 px-6 py-14">
      <EmptyMedia variant="default" className="text-muted-foreground [&_svg]:size-7">
        {icon}
      </EmptyMedia>
      <EmptyHeader className="gap-2">
        <EmptyTitle className="text-sm font-medium text-foreground">{title}</EmptyTitle>
        {description && (
          <EmptyDescription className="max-w-md text-xs leading-5">{description}</EmptyDescription>
        )}
      </EmptyHeader>
      {action && <EmptyContent className="mt-2 max-w-none">{action}</EmptyContent>}
    </Empty>
  );
}
