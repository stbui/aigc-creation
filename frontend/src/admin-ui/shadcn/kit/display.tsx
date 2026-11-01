import { useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Inbox, Info, Lock, X } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Badge, Button } from '../../components/ui';
import { STATUS_META, type TagTone } from '../../../components/admin/statusMeta';
import { AdminEmpty, AdminListError, AdminStaleError, Panel, SaveBar, StatCard } from '../layout';

/**
 * 页面骨架控件（shadcn 版）—— 与 `admin-ui/widgets/AdminChrome` + `primitives` 同名同签名。
 *
 * 位置在 `shadcn/kit/` 而不是 `shadcn/`：`shadcn` 根目录的 `layout.tsx` / `forms.tsx`
 * 是**新页面直接写**的一套；`kit/` 是**把既有页面整页换皮**用的一层，签名必须
 * 与 BoardUI 版逐字对齐，否则 4400 行的调用点就得跟着改。
 *
 * 两边的观感是同一套（卡片 + 弱投影 + 语义色令牌），差别只在 `kit` 多了
 * 为旧签名准备的兼容入参（如 `extra` / `note` / `minWidth`）。
 */

export { AdminEmpty, AdminListError, AdminStaleError, Panel, SaveBar, StatCard };

/* ────────────────────────── 空态 ────────────────────────── */

/**
 * 空态：说明为什么空 + 下一步能做什么。
 *
 * 比 `layout.EmptyState` 多一个 `icon` 入参 —— 存量页面有传自定义图标的调用点，
 * 去掉会让那一处的空态退回默认信箱图标，看不出「这里其实是成功的」。
 */
export function EmptyState({
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
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="text-muted-foreground [&>svg]:size-7">
        {icon ?? <InboxIcon />}
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="max-w-md text-xs leading-5 text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

function InboxIcon() {
  return <Inbox className="size-7" aria-hidden />;
}

/* ────────────────────────── 彩色标签（Chip） ────────────────────────── */

export type ChipVariant = 'bold' | 'subtle' | 'caption';
export type ChipColor =
  | 'orange'
  | 'lime'
  | 'rose'
  | 'yellow'
  | 'cyan'
  | 'blue'
  | 'purple'
  | 'neutral'
  | 'gray'
  | 'soft';

const CHIP_COLOR_CLASS: Record<ChipColor, string> = {
  lime: 'bg-success-soft text-success-text',
  rose: 'bg-danger-soft text-danger-text',
  yellow: 'bg-warn-soft text-warn-text',
  orange: 'bg-warn-soft text-warn-text',
  purple: 'bg-accent text-accent-foreground',
  blue: 'bg-accent text-accent-foreground',
  cyan: 'bg-accent text-accent-foreground',
  neutral: 'bg-muted text-muted-foreground',
  gray: 'bg-muted text-foreground',
  soft: 'bg-muted text-muted-foreground',
};

const CHIP_VARIANT_CLASS: Record<ChipVariant, string> = {
  bold: 'py-0.5 text-[13px] font-medium',
  subtle: 'py-1 text-[13px] font-medium',
  caption: 'py-1 text-[11px] font-medium',
};

/**
 * 彩色标签（BoardUI `Chip` 的同名替代）。
 *
 * 颜色刻意「折叠」到项目的五档语义色：BoardUI 有 10 档颜色，但后台用到的
 * 其实只有「成功 / 警示 / 危险 / 品牌 / 中性」五种语义。留给调用方的同名入参
 * 保持不变，调用点不必改；新代码应直接用语义更明确的 `StatusTag` / `ToneBadge`。
 */
export function Chip({
  variant = 'bold',
  color = 'soft',
  className,
  children,
  ...rest
}: {
  variant?: ChipVariant;
  color?: ChipColor;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-md px-1.5 whitespace-nowrap',
        CHIP_VARIANT_CLASS[variant],
        CHIP_COLOR_CLASS[color],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

/* ────────────────────────── 页头 ────────────────────────── */

/**
 * 页面标题区（旧名 `PageHeader`）。
 *
 * 与 `PageTitle` 的差别只是入参形态：旧签名 `title` 是 `string`、`description`
 * 是 `string`（会 `truncate`）。这里不截断 —— 长描述被切掉后用户看不出
 * 「这句话在说谁」，而渠道工作台的描述正好是解释性长句。
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && (
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground" title={description}>
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ────────────────────────── 筛选条 ────────────────────────── */

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-testid="admin-filter"
      className={cn(
        'mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 shadow-card',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FilterActions({ children }: { children: ReactNode }) {
  return (
    <div data-testid="admin-filter-actions" className="ml-auto flex shrink-0 items-center gap-2">
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
 * `basis-full` 让它单独占一行：与「查询 / 重置」挤在同一行时，按钮和回显
 * 会混成一串，用户分不清哪个是动作、哪个是状态。
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
        <span
          key={item.key}
          data-testid="admin-filter-chip"
          data-filter-key={item.key}
          title={item.label}
          className="inline-flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-xs text-accent-foreground"
        >
          <span className="max-w-[220px] truncate">{item.label}</span>
          {item.onClear && (
            <button
              type="button"
              aria-label={`清除筛选：${item.label}`}
              className="rounded text-accent-foreground/70 transition-colors hover:text-accent-foreground"
              onClick={item.onClear}
            >
              <X className="size-3" aria-hidden />
            </button>
          )}
        </span>
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
 * 文案与色调的单一事实源仍是 `components/admin/statusMeta.ts` 的 `STATUS_META` ——
 * 这里只换了渲染件（Chip → Badge），不复制那张表。未登记状态回退原值，
 * 不隐藏：「不认识的标签」比「没有标签」更容易被运维发现。
 */
export function StatusTag({
  status,
  label,
  tone,
}: {
  status: string;
  label?: string;
  tone?: TagTone;
}) {
  const meta = STATUS_META[status] ?? { label: status, tone: 'muted' as TagTone };
  return (
    <Badge
      variant="secondary"
      data-status={status}
      className={cn(
        'h-5 rounded-md border-transparent px-1.5 text-[11px] font-medium',
        TAG_TONE_CLASS[tone ?? meta.tone],
      )}
    >
      {label ?? meta.label}
    </Badge>
  );
}

/* ────────────────────────── 提示条 ────────────────────────── */

const NOTICE_META = {
  info: { Icon: Info, cls: 'border-sky-200 bg-sky-50 text-sky-900' },
  success: { Icon: CheckCircle2, cls: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
  warn: { Icon: AlertTriangle, cls: 'border-amber-200 bg-amber-50 text-amber-900' },
  danger: { Icon: AlertTriangle, cls: 'border-rose-200 bg-rose-50 text-rose-900' },
  locked: { Icon: Lock, cls: 'border-border bg-muted text-muted-foreground' },
} as const;

/**
 * 页面级提示条。
 *
 * 与 `admin-ui/primitives` 的同名件同签名、同四档语气。按 `danger` 走
 * `role="alert"`，其余 `role="status"` —— 颜色不是唯一的严重性信号，
 * 读屏用户也要能听出「这条要马上处理」。
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
  const rendered = icon === null ? null : (icon ?? <meta.Icon className="size-4 shrink-0" aria-hidden />);

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('mb-3 flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5', meta.cls, className)}
    >
      {rendered && <span className="mt-px shrink-0">{rendered}</span>}
      <div className="min-w-0 flex-1 text-xs leading-5">
        {title && <div className="font-semibold">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/* ────────────────────────── 键值描述 ────────────────────────── */

/** 详情页的信息层级靠「标签 / 值」两列，不靠卡片嵌套 */
export function Descriptions({
  items,
  columns = 1,
}: {
  items: Array<{ label: ReactNode; value: ReactNode }>;
  columns?: 1 | 2 | 3;
}) {
  const colClass = columns === 3 ? 'sm:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : '';
  return (
    <dl data-testid="admin-desc" className={cn('grid grid-cols-1 gap-x-6 gap-y-3', colClass)}>
      {items.map((item, index) => (
        <div key={index} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ────────────────────────── 骨架屏 ────────────────────────── */

export function Skeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-9 animate-pulse rounded-lg bg-muted"
          style={{ animationDelay: `${index * 80}ms` }}
        />
      ))}
    </div>
  );
}

/* ────────────────────────── 分页 ────────────────────────── */

/**
 * 分页条（BoardUI `Pagination` 的同名替代）。
 *
 * 只做「上一页 / 页码 / 下一页」：后台列表一次最多 100 行，页码窗口按
 * `siblingCount` 展开，超出用省略号收窄 —— 页码太多时逐个数反而更慢。
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
  const showLeadingDots = start > 2;
  const showTrailingDots = end < total - 1;

  return (
    <nav className={cn('flex items-center gap-1', className)} aria-label={ariaLabel}>
      <Button
        variant="outline"
        size="xs"
        disabled={current <= 1}
        onClick={() => onChange(current - 1)}
      >
        {previousLabel}
      </Button>

      {start > 1 && (
        <PageCell page={1} current={current} onChange={onChange} />
      )}
      {showLeadingDots && <span className="px-1 text-xs text-muted-foreground">…</span>}
      {pages.map((item) => (
        <PageCell key={item} page={item} current={current} onChange={onChange} />
      ))}
      {showTrailingDots && <span className="px-1 text-xs text-muted-foreground">…</span>}
      {end < total && <PageCell page={total} current={current} onChange={onChange} />}

      <Button
        variant="outline"
        size="xs"
        disabled={current >= total}
        onClick={() => onChange(current + 1)}
      >
        {nextLabel}
      </Button>
    </nav>
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
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={() => onChange(page)}
      className={cn(
        'inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-xs tabular-nums transition-colors',
        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active
          ? 'border border-border bg-card font-medium text-foreground shadow-xs'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {page}
    </button>
  );
}

/* ────────────────────────── 可折叠面板 ────────────────────────── */

/** 可折叠分区：默认收起，展开态写回受控值（页面把展开状态放在 URL 里） */
export function CollapsiblePanel({
  title,
  note,
  extra,
  defaultOpen = false,
  open,
  onToggle,
  collapsedHint,
  children,
}: {
  title?: string;
  note?: string;
  extra?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (next: boolean) => void;
  collapsedHint?: ReactNode;
  children: ReactNode;
}) {
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = open ?? inner;

  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setInner(next);
    onToggle?.(next);
  };

  return (
    <section className="mb-3 overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
      >
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            !isOpen && '-rotate-90',
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
          {title}
          {note && <span className="ml-2 text-xs font-normal text-muted-foreground">{note}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {isOpen ? extra : (collapsedHint ?? extra)}
        </span>
      </button>
      {isOpen && <div className="border-t border-border px-4 py-3">{children}</div>}
    </section>
  );
}

/* ────────────────────────── 列表加载态 ────────────────────────── */

/** 保持布局稳定的骨架屏：空 div 撑不出真实列表高度，数据到达时会跳动 */
export function AdminListLoading({ tip = '加载中…' }: { tip?: string }) {
  return (
    <div
      data-testid="admin-page-loading"
      className="flex flex-col gap-3 px-1 py-6"
      aria-busy="true"
      aria-live="polite"
    >
      <Skeleton rows={5} />
      <p className="text-center text-xs text-muted-foreground">{tip}</p>
    </div>
  );
}

/* ────────────────────────── 结果页 ────────────────────────── */

/** 结果页 / 失败页：错误必须可读、可重试 */
export function Result({
  tone = 'error',
  title,
  description,
  actions,
}: {
  tone?: 'error' | 'success' | 'info';
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  const toneClass =
    tone === 'error'
      ? 'border-danger-soft bg-danger-soft'
      : tone === 'success'
        ? 'border-success-soft bg-success-soft'
        : 'border-border bg-muted';
  return (
    <div className={cn('rounded-xl border p-6', toneClass)}>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
      )}
      {actions && <div className="mt-4 flex gap-2">{actions}</div>}
    </div>
  );
}

/* ────────────────────────── 步骤条 ────────────────────────── */

/** 步骤条：状态流转用「已完成 / 当前 / 未开始」三态，不画进度动画 */
export function Steps({
  items,
  className,
}: {
  items: Array<{ title: ReactNode; description?: ReactNode; done?: boolean; active?: boolean }>;
  className?: string;
}) {
  return (
    <ol className={cn('flex flex-col gap-0', className)}>
      {items.map((item, index) => {
        const state = item.done ? 'done' : item.active ? 'active' : 'todo';
        return (
          <li key={index} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'mt-1 size-2.5 shrink-0 rounded-full border-2',
                  state === 'done' && 'border-primary bg-primary',
                  state === 'active' && 'border-primary bg-card',
                  state === 'todo' && 'border-border bg-card',
                )}
                aria-hidden
              />
              {index < items.length - 1 && (
                <span className="w-px flex-1 bg-border" aria-hidden />
              )}
            </div>
            <div className={cn('pb-4', index === items.length - 1 && 'pb-0')}>
              <p
                className={cn(
                  'text-sm',
                  state === 'todo' ? 'text-muted-foreground' : 'font-medium text-foreground',
                )}
              >
                {item.title}
              </p>
              {item.description && (
                <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {item.description}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
