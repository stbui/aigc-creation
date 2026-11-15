/**
 * 中性风格（freebie-radar 设计语言）后台构建块。
 *
 * 与 `~/admin-ui/primitives`（品牌紫 / shadcn 后台）一一对应的雷达版：同样的
 * 结构语义（页头 / 面板 / 统计卡 / 分段筛选 / 空态 / 失败态 / 骨架 / 待办队列），
 * 但全部走 `radar-*` 令牌与「零阴影 + 1px 细线 + 颜色编码语义」语言。
 *
 * 用途：后台页面从品牌紫逐步迁到中性风格的过渡期，先以这些块替换页面里的
 * shadcn 原语，逻辑（数据 Hook、severity 元数据、筛选）保持不变。
 *
 * 约定：本文件只消费 radar 令牌与 `./Button` / `./Badge` 原语，**不 import 任何
 * shadcn / 品牌紫令牌**；令牌由 `styles/radar-admin.css` 在被消费页面 chunk 内载入。
 */
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Inbox,
  LoaderCircle,
  RotateCcw,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { RadarBadge } from './Badge';
import type {
  AdminWorkbenchGroup,
  AdminWorkbenchItem,
  AdminWorkbenchSeverity,
} from '../../types/api';

/* ────────────────────────── 全幅画布容器 ────────────────────────── */

/**
 * 中性风格页面容器：用 `radar-canvas` 灰底铺满后台内容区（抵消外壳的 26/18 内边距），
 * 内部白底细线面板浮在上面 —— freebie-radar 的标志性「灰底 + 白卡」层次。
 *
 * 负值外边距与 `AdminBoardLayout` 内容区的 `px-[26px] pt-[18px]` 对齐；
 * 外壳该值改动时这里需同步。
 */
export function RadarPage({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'radar-scope bg-radar-canvas -mx-[26px] -mt-[18px] min-h-full px-[26px] pb-14 pt-[18px]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ────────────────────────── 页头 ────────────────────────── */

/** 页面标题区：标题 + 副标题在左，操作在右。副标题不截断，照常渲染。 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** 兼容 shadcn 同签名的占位项；radar 固定副标题在下，不展开内联。 */
  inlineDescription?: boolean;
}) {
  return (
    <header
      data-testid="admin-page-header"
      className={cn('flex items-start justify-between gap-4 pb-4', className)}
    >
      <div className="min-w-0 flex-1">
        <h1 className="text-[22px] font-semibold tracking-tight text-radar-ink-950">{title}</h1>
        {description && (
          <p className="mt-1 text-[13px] leading-5 text-radar-ink-500">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ────────────────────────── 面板 ────────────────────────── */

/**
 * 内容面板：白底 + 1px 细线 + 8px 圆角（零阴影）。可选标题行（h2）+ 口径说明 +
 * 右侧 extra（如分段筛选）；标题区下方用单根细线与内容分隔（不描边堆叠）。
 */
export function Panel({
  title,
  note,
  extra,
  narrow = false,
  className,
  children,
}: {
  title?: ReactNode;
  note?: ReactNode;
  extra?: ReactNode;
  /** 限制内容宽度到 760px（表单型页面阅读宽度）。 */
  narrow?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      data-testid="admin-panel"
      style={narrow ? { maxWidth: 760 } : undefined}
      className={cn('panel mb-4 overflow-hidden', className)}
    >
      {(title || extra) && (
        <div className="flex items-center gap-3 px-5 py-3">
          <div className="min-w-0 flex-1">
            {title && (
              <h2 className="text-[13px] font-semibold text-radar-ink-900">{title}</h2>
            )}
            {note && (
              <p className="mt-0.5 text-[12.5px] leading-5 text-radar-ink-400">{note}</p>
            )}
          </div>
          {extra && <div className="flex shrink-0 items-center gap-2">{extra}</div>}
        </div>
      )}
      <div className={cn('p-5', (title || extra) && 'border-t border-radar-ink-100')}>
        {children}
      </div>
    </section>
  );
}

/* ────────────────────────── 统计卡 ────────────────────────── */

/** 单张统计卡：标签 + 数字（`tabular-nums` 等宽对齐）+ 提示；tone 染色。 */
export function StatCard({
  label,
  value,
  hint,
  tone,
  inline = false,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'danger' | 'warn';
  /** 指标卡内容较少时，标签和值并排，避免多占一行。 */
  inline?: boolean;
  className?: string;
}) {
  const toneSurface =
    tone === 'danger'
      ? 'bg-radar-alert-subtle border-radar-alert-border'
      : tone === 'warn'
        ? 'bg-radar-code-subtle border-radar-code-border'
        : 'bg-radar-surface border-radar-ink-200';
  const valueColor =
    tone === 'danger'
      ? 'text-radar-alert'
      : tone === 'warn'
        ? 'text-radar-code'
        : 'text-radar-ink-950';
  return (
    <div
      data-testid="admin-stat-card"
      className={cn(
        'justify-center rounded-[8px] border px-4 py-3',
        inline ? 'min-h-0' : 'min-h-[92px]',
        toneSurface,
        className,
      )}
    >
      {inline ? (
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="shrink-0 text-[13px] font-medium text-radar-ink-500">{label}</div>
          <div className={cn(valueColor, 'whitespace-nowrap text-[18px] leading-6')}>{value}</div>
        </div>
      ) : (
        <>
          <div className="text-[13px] font-medium text-radar-ink-500">{label}</div>
          <div className={cn('mt-1 text-[22px] font-semibold leading-7 tabular-nums', valueColor)}>
            {value}
          </div>
        </>
      )}
      {hint && <div className="mt-0.5 text-[12px] leading-5 text-radar-ink-400">{hint}</div>}
    </div>
  );
}

/** 统计卡数据形态；与 `StatCard` props 对齐。 */
export interface StatCardItem {
  key?: string;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'danger' | 'warn';
}

const STAT_COLUMNS_CLASS = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
} as const;

/** 统计卡组：统一列数与间距，页面只给数据。 */
export function StatCards({
  items,
  columns = 'auto',
  minWidth = 170,
  inline = false,
  className,
}: {
  items: readonly StatCardItem[];
  columns?: keyof typeof STAT_COLUMNS_CLASS | 'auto';
  minWidth?: number;
  inline?: boolean;
  className?: string;
}) {
  return (
    <div
      data-testid="admin-stat-grid"
      className={cn(
        'grid gap-3',
        columns === 'auto' ? undefined : STAT_COLUMNS_CLASS[columns],
        className,
      )}
      style={
        columns === 'auto'
          ? { gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}px, 1fr))` }
          : undefined
      }
    >
      {items.map((item) => (
        <StatCard
          key={item.key ?? item.label}
          label={item.label}
          value={item.value}
          hint={item.hint}
          tone={item.tone}
          inline={inline}
        />
      ))}
    </div>
  );
}

/* ────────────────────────── 分段筛选 ────────────────────────── */

/** 分段选项组（胶囊式单选）：浅灰轨道 + 选中浮起成墨黑实心。语义是筛选维度。 */
export function Segmented({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: ReactNode }>;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex rounded-[8px] border border-radar-ink-200 bg-radar-surface p-0.5',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-[6px] px-3 py-1.5 text-[13px] font-medium transition-colors',
              active
                ? 'bg-radar-brand text-white'
                : 'text-radar-ink-600 hover:bg-radar-ink-100',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ────────────────────────── 列表态 ────────────────────────── */

/** 空态：说明为什么空 + 下一步能做什么，不留一片白。 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-6 py-14 text-center', className)}>
      <Inbox className="size-7 text-radar-ink-300" aria-hidden />
      <p className="text-[14px] font-medium text-radar-ink-700">{title}</p>
      {description && (
        <p className="max-w-md text-[13px] leading-5 text-radar-ink-400">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** 首屏失败：没有任何可用数据，只能重试。 */
export function ListError({
  error,
  onRetry,
  className,
}: {
  error: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-[8px] border border-radar-alert-border bg-radar-alert-subtle px-6 py-12',
        className,
      )}
    >
      <AlertTriangle className="size-5 text-radar-alert" aria-hidden />
      <p className="text-[14px] font-medium text-radar-ink-900">加载失败</p>
      <p className="max-w-md text-[13px] leading-5 text-radar-ink-500">{error}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RotateCcw className="size-4" />
          重试
        </Button>
      )}
    </div>
  );
}

/**
 * 刷新失败、但手上有上一次成功的数据。补一句话说明「这页是旧的」。
 */
export function StaleError({
  error,
  onRetry,
  className,
}: {
  error: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        'mb-4 flex items-start gap-2 rounded-[8px] border border-radar-code-border bg-radar-code-subtle px-3 py-2.5 text-[13px] text-radar-code',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <strong className="font-medium">刷新失败，下面是上一次成功获取的数据</strong>
        <div className="mt-0.5 opacity-80">{error}</div>
      </div>
      <Button variant="ghost" size="sm" onClick={onRetry} className="shrink-0 text-radar-code">
        重试
      </Button>
    </div>
  );
}

/** 内容行骨架：只替正文，面板外壳由真实 `Panel` 提供。 */
export function SkeletonBody({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-9 rounded-[6px] bg-radar-ink-100" />
      ))}
    </div>
  );
}

/* ────────────────────────── 待办队列 ────────────────────────── */

const WB_SEVERITY_STYLE: Record<
  AdminWorkbenchSeverity,
  { badge: string; dot: string; label: string }
> = {
  critical: { badge: 'bg-radar-alert-subtle text-radar-alert', dot: 'bg-radar-alert', label: '紧急' },
  warning: { badge: 'bg-radar-code-subtle text-radar-code', dot: 'bg-radar-code', label: '需处理' },
  info: { badge: 'bg-radar-ink-100 text-radar-ink-600', dot: 'bg-radar-ink-400', label: '提示' },
};

function withReturnTo(path: string, returnTo: string): string {
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  if (!params.get('returnTo')) params.set('returnTo', returnTo);
  const next = params.toString();
  return next ? `${base}?${next}` : base;
}

/**
 * 角色首屏的待办队列：每组展示后端给出的前几条实体行，完整列表走 `group.link`。
 * 行本身是带 returnTo 的跳转，不在队列里直接执行写操作。
 */
export function WorkQueue({
  groups,
  loading = false,
  error = null,
  emptyTitle = '当前没有待处理事项',
  emptyDescription = '告警、退款、对账与备份都在正常范围内。',
  hideEmptyGroups = false,
  className,
}: {
  groups: AdminWorkbenchGroup[];
  loading?: boolean;
  error?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  hideEmptyGroups?: boolean;
  className?: string;
}) {
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;
  const visibleGroups =
    hideEmptyGroups && groups.some((group) => group.items.length > 0)
      ? groups.filter((group) => group.items.length > 0)
      : groups;

  if (loading && groups.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-[8px] border border-radar-ink-200 bg-radar-surface px-4 py-6 text-[13px] text-radar-ink-500',
          className,
        )}
        aria-busy="true"
      >
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        正在加载待办…
      </div>
    );
  }

  if (error && groups.length === 0) {
    return (
      <div
        className={cn(
          'flex items-start gap-2 rounded-[8px] border border-radar-alert-border bg-radar-alert-subtle px-4 py-4 text-[13px] text-radar-alert',
          className,
        )}
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{error}</span>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center rounded-[8px] border border-radar-ink-200 bg-radar-surface px-4 py-8 text-center',
          className,
        )}
      >
        <CheckCircle2 className="mb-2 size-6 text-radar-deal" aria-hidden />
        <p className="text-[14px] font-medium text-radar-ink-900">{emptyTitle}</p>
        <p className="mt-1 text-[13px] leading-5 text-radar-ink-400">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {visibleGroups.map((group) => {
        const style = WB_SEVERITY_STYLE[group.severity];
        const amount = group.amountCents !== undefined ? `¥${(group.amountCents / 100).toFixed(2)}` : null;
        return (
          <section
            key={group.key}
            className="panel overflow-hidden"
            aria-labelledby={`workbench-group-${group.key}`}
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-radar-ink-100 px-5 py-3">
              <RadarBadge className={style.badge}>{style.label}</RadarBadge>
              <h3
                id={`workbench-group-${group.key}`}
                className="text-[13px] font-semibold text-radar-ink-900"
              >
                {group.label}
              </h3>
              <span className="text-[14px] font-semibold tabular-nums text-radar-ink-950">
                {group.count}
              </span>
              {amount && (
                <span className="text-[12px] tabular-nums text-radar-ink-400">涉及 {amount}</span>
              )}
              <Link
                to={group.link}
                className="ml-auto inline-flex items-center gap-1 text-[13px] font-medium text-radar-brand hover:underline"
              >
                查看全部
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>

            {group.items.length === 0 ? (
              <div className="px-5 py-3 text-[13px] text-radar-ink-400">
                该类没有可展开的实体行，点击「查看全部」处理。
              </div>
            ) : (
              <ul className="divide-y divide-radar-ink-100">
                {group.items.map((item) => (
                  <WorkQueueRow key={item.id} item={item} severity={group.severity} returnTo={returnTo} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function WorkQueueRow({
  item,
  severity,
  returnTo,
}: {
  item: AdminWorkbenchItem;
  severity: AdminWorkbenchSeverity;
  returnTo: string;
}) {
  const tone = WB_SEVERITY_STYLE[severity];
  const extraMeta = item.meta.filter((meta) => meta.value !== item.subtitle);
  return (
    <li>
      <Link
        to={withReturnTo(item.target.path, returnTo)}
        className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-radar-surface-hover"
      >
        <span className={cn('size-1.5 shrink-0 rounded-full', tone.dot)} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-radar-ink-900">
            {item.title}
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] text-radar-ink-400">
            {item.subtitle}
          </span>
        </span>
        {extraMeta.length > 0 && (
          <span className="hidden shrink-0 items-center gap-2 text-[12px] text-radar-ink-400 xl:flex">
            {extraMeta.map((meta) => (
              <span key={meta.label} className="whitespace-nowrap">
                {meta.label}
                <span
                  className={cn(
                    'ml-1 font-medium text-radar-ink-700',
                    meta.tone === 'danger' && 'text-radar-alert',
                    meta.tone === 'warn' && 'text-radar-code',
                  )}
                >
                  {meta.value}
                </span>
              </span>
            ))}
          </span>
        )}
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[13px] font-medium text-radar-brand">
          处理
          <ArrowRight className="size-3" aria-hidden />
        </span>
      </Link>
    </li>
  );
}

/** 便于页面在队列上方放标题与操作。 */
export function WorkQueueSection({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-radar-ink-950">{title}</h2>
          {description && (
            <p className="mt-0.5 text-[13px] leading-5 text-radar-ink-500">{description}</p>
          )}
        </div>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
