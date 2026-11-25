/**
 * 角色首屏的待办队列。
 *
 * 从 `blocks.tsx` 拆出：队列自带取址（`useLocation`）、严重度配色与 returnTo
 * 拼装，和页头 / 面板那类纯骨架不是一类东西。页面仍从 `./index` 取件。
 */
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, LoaderCircle } from 'lucide-react';
import { cn } from '../lib/cn';
import { RadarBadge } from './Badge';
import type {
  AdminWorkbenchGroup,
  AdminWorkbenchItem,
  AdminWorkbenchSeverity,
} from '../../types/api';

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
  compact = false,
  className,
}: {
  groups: AdminWorkbenchGroup[];
  loading?: boolean;
  error?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  hideEmptyGroups?: boolean;
  /**
   * 紧凑模式（2026-11-25）：每组明细默认收起，只留「标签 + 计数 + 查看全部」
   * 一行摘要，点击整行展开。概览页用它避免几十条实体行把 KPI 指标挤出首屏；
   * 告警页按来源排障需要明细常显，不传此 prop（默认 false）保持原样。
   */
  compact?: boolean;
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
          <section key={group.key} className="panel overflow-hidden">
            <details open={!compact} className="group">
              {/*
               * 紧凑模式把整行做成 summary：默认收起时首屏只占一行，KPI 指标
               * 得以先于明细出现（数据结论优先，明细按需展开）。非紧凑模式
               * 用 open 恒定展开，summary 仍可点但视觉上是普通标题行。
               */}
              <summary
                className="flex cursor-pointer flex-wrap items-center gap-2 border-b border-radar-ink-100 px-5 py-3 outline-none transition-colors hover:bg-radar-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-radar-brand [&::-webkit-details-marker]:hidden"
                aria-label={`${group.label}，${group.count} 项，点击${compact ? '展开' : '收起'}明细`}
              >
                <RadarBadge className={style.badge}>{style.label}</RadarBadge>
                <h3 className="text-[13px] font-semibold text-radar-ink-900">{group.label}</h3>
                <span className="text-[14px] font-semibold tabular-nums text-radar-ink-950">
                  {group.count}
                </span>
                {amount && (
                  <span className="text-[12px] tabular-nums text-radar-ink-400">涉及 {amount}</span>
                )}
                {compact && (
                  <ChevronDown
                    className="size-3.5 text-radar-ink-400 transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                )}
                <Link
                  to={group.link}
                  onClick={(event) => event.stopPropagation()}
                  className="ml-auto inline-flex items-center gap-1 text-[13px] font-medium text-radar-brand hover:underline"
                >
                  查看全部
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </summary>

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
            </details>
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
  actions?: React.ReactNode;
  children: React.ReactNode;
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
