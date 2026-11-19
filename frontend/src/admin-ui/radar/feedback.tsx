import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Lock, X } from 'lucide-react';
import {
  Pagination as PaginationRoot,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from '../components/ui/pagination';
import { Progress } from '../components/ui/progress';
import { STATUS_META, type TagTone } from '../../components/admin/statusMeta';
import { cn } from '../lib/cn';
import { Button } from './Button';

export type { TagTone };

/* ────────────────────────── 状态标签 ────────────────────────── */

const TAG_TONE_CLASS: Record<TagTone, string> = {
  success: 'bg-radar-deal-subtle text-radar-deal',
  danger: 'bg-radar-alert-subtle text-radar-alert',
  warn: 'bg-radar-code-subtle text-radar-code',
  brand: 'bg-radar-ink-100 text-radar-ink-700',
  muted: 'bg-radar-ink-100 text-radar-ink-600',
};

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
    <span
      data-status={status}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] leading-4 font-medium',
        TAG_TONE_CLASS[tone ?? meta.tone],
      )}
    >
      {showDot && (
        <span data-testid="status-dot" className="size-1.5 rounded-full bg-current" aria-hidden />
      )}
      {label ?? meta.label}
    </span>
  );
}

/* ────────────────────────── 提示条 ────────────────────────── */

const NOTICE_META = {
  info: { Icon: Info, cls: 'border-radar-ink-200 bg-radar-surface-hover text-radar-ink-700' },
  success: {
    Icon: CheckCircle2,
    cls: 'border-radar-deal-border bg-radar-deal-subtle text-radar-deal',
  },
  warn: { Icon: AlertTriangle, cls: 'border-radar-code-border bg-radar-code-subtle text-radar-code' },
  danger: {
    Icon: AlertTriangle,
    cls: 'border-radar-alert-border bg-radar-alert-subtle text-radar-alert',
  },
  locked: { Icon: Lock, cls: 'border-radar-ink-200 bg-radar-surface-hover text-radar-ink-500' },
} as const;

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
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'mb-4 flex items-start gap-2.5 rounded-[8px] border px-3.5 py-2.5 text-[13px]',
        meta.cls,
        className,
      )}
    >
      {rendered && <span className="mt-px shrink-0 [&_svg]:size-4">{rendered}</span>}
      <div className="min-w-0 flex-1 leading-5">
        {title && <div className="font-semibold">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/* ────────────────────────── 比例条 ────────────────────────── */

export function Meter({
  value,
  tone = 'brand',
  className,
  label,
  decorative = false,
}: {
  value: number;
  tone?: 'brand' | 'danger' | 'success' | 'warn';
  className?: string;
  label?: string;
  decorative?: boolean;
}) {
  const indicator =
    tone === 'danger'
      ? '[&>[data-slot=progress-indicator]]:bg-radar-alert'
      : tone === 'warn'
        ? '[&>[data-slot=progress-indicator]]:bg-radar-code'
        : tone === 'success'
          ? '[&>[data-slot=progress-indicator]]:bg-radar-deal'
          : '[&>[data-slot=progress-indicator]]:bg-radar-brand';
  return (
    <Progress
      value={Math.max(0, Math.min(100, value))}
      aria-label={label}
      aria-hidden={decorative || undefined}
      className={cn(
        'h-2 gap-0 rounded-full bg-radar-ink-100 [&>[data-slot=progress-indicator]]:rounded-full',
        indicator,
        className,
      )}
    />
  );
}

/* ────────────────────────── 键值描述 ────────────────────────── */

export function Descriptions({
  items,
  columns = 1,
  inline = false,
}: {
  items: Array<{ label: ReactNode; value: ReactNode }>;
  columns?: 1 | 2 | 3;
  inline?: boolean;
}) {
  const colClass =
    columns === 3 ? 'sm:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : '';
  return (
    <dl data-testid="admin-desc" className={cn('grid grid-cols-1 gap-x-6 gap-y-3', colClass)}>
      {items.map((item, index) => (
        <div key={index} className={cn('min-w-0', inline && 'flex items-baseline gap-3')}>
          <dt className={cn('text-[12px] text-radar-ink-500', inline && 'w-20 shrink-0')}>
            {item.label}
          </dt>
          <dd
            className={
              inline
                ? 'min-w-0 flex-1 text-[13px] text-radar-ink-900'
                : 'mt-0.5 text-[13px] text-radar-ink-900'
            }
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ────────────────────────── 紧凑指标 ────────────────────────── */

export function MiniStat({
  label,
  value,
  tone,
  size = 'lg',
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: 'success' | 'danger' | 'warn' | 'muted';
  size?: 'lg' | 'xl';
}) {
  return (
    <div className="min-w-0 px-4 py-3 first:pl-0 last:pr-0">
      <dt className="text-[12px] font-medium text-radar-ink-500">{label}</dt>
      <dd
        className={cn(
          'mt-1 leading-6 font-semibold tabular-nums',
          size === 'xl' ? 'text-[20px]' : 'text-[18px]',
          tone === 'success' && 'text-radar-deal',
          tone === 'danger' && 'text-radar-alert',
          tone === 'warn' && 'text-radar-code',
          tone === 'muted' && 'text-radar-ink-400',
          !tone && 'text-radar-ink-950',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/* ────────────────────────── 分页 ────────────────────────── */

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
    <PaginationRoot className={cn('mx-0 w-auto justify-start', className)} aria-label={ariaLabel}>
      <PaginationContent className="gap-1">
        <PaginationItem>
          <Button
            variant="secondary"
            size="sm"
            disabled={current <= 1}
            onClick={() => onChange(current - 1)}
          >
            <ChevronLeft className="size-3.5" aria-hidden />
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
            <PaginationEllipsis className="size-6 text-radar-ink-400" />
          </PaginationItem>
        )}
        {pages.map((item) => (
          <PaginationItem key={item}>
            <PageCell page={item} current={current} onChange={onChange} />
          </PaginationItem>
        ))}
        {end < total - 1 && (
          <PaginationItem>
            <PaginationEllipsis className="size-6 text-radar-ink-400" />
          </PaginationItem>
        )}
        {end < total && (
          <PaginationItem>
            <PageCell page={total} current={current} onChange={onChange} />
          </PaginationItem>
        )}
        <PaginationItem>
          <Button
            variant="secondary"
            size="sm"
            disabled={current >= total}
            onClick={() => onChange(current + 1)}
          >
            {nextLabel}
            <ChevronRight className="size-3.5" aria-hidden />
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
      variant={active ? 'default' : 'ghost'}
      size="sm"
      aria-current={active ? 'page' : undefined}
      aria-label={`第 ${page} 页`}
      onClick={() => onChange(page)}
      className={cn('tabular-nums', active && 'font-medium')}
    >
      {page}
    </Button>
  );
}

/* ────────────────────────── 筛选条 ────────────────────────── */

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-testid="admin-filter"
      className={cn(
        'mb-3 flex flex-wrap items-center gap-2 rounded-[8px] border border-radar-ink-200 bg-radar-surface px-3 py-2.5',
        className,
      )}
    >
      {children}
    </div>
  );
}

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
      <span className="text-[13px] text-radar-ink-500">已筛选</span>
      {items.map((item) => (
        <span
          key={item.key}
          data-testid="admin-filter-chip"
          data-filter-key={item.key}
          title={item.label}
          className="inline-flex max-w-[240px] items-center gap-1 overflow-hidden rounded border border-radar-ink-200 bg-radar-surface-hover px-1.5 py-0.5 text-[12px] text-radar-ink-700"
        >
          <span className="truncate">{item.label}</span>
          {item.onClear && (
            <button
              type="button"
              aria-label={`清除筛选：${item.label}`}
              onClick={item.onClear}
              className="shrink-0 rounded-sm p-0 text-radar-ink-400 hover:text-radar-ink-900"
            >
              <X className="size-3" aria-hidden />
            </button>
          )}
        </span>
      ))}
      {onClearAll && (
        <button
          type="button"
          className="ml-1 text-[12px] text-radar-ink-500 hover:text-radar-ink-900"
          onClick={onClearAll}
        >
          清除全部
        </button>
      )}
    </div>
  );
}
