import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, LoaderCircle } from 'lucide-react';
import { cn } from '../lib/cn';
import type {
  AdminWorkbenchGroup,
  AdminWorkbenchSeverity,
} from '../../types/api';

const SEVERITY_STYLE: Record<
  AdminWorkbenchSeverity,
  { badge: string; dot: string; label: string }
> = {
  critical: {
    badge: 'bg-danger-soft text-danger-text',
    dot: 'bg-danger-text',
    label: '紧急',
  },
  warning: {
    badge: 'bg-warn-soft text-warn-text',
    dot: 'bg-warn-text',
    label: '需处理',
  },
  info: {
    badge: 'bg-accent text-brand',
    dot: 'bg-brand',
    label: '提示',
  },
};

function currency(cents: number | undefined): string | null {
  if (cents === undefined || cents === null) return null;
  return `¥${(cents / 100).toFixed(2)}`;
}

/**
 * 给目标链接补 `returnTo`。
 *
 * 工作台同时出现在 `/admin` 与 `/admin/alerts`，由组件在渲染时带上当前
 * 地址，来源页不必各自拼一遍；已有 `returnTo` 的目标页保持原值。
 */
function withReturnTo(path: string, returnTo: string): string {
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  if (!params.get('returnTo')) params.set('returnTo', returnTo);
  const next = params.toString();
  return next ? `${base}?${next}` : base;
}

/**
 * 角色首屏的待办队列。
 *
 * 每组只展示后端给出的前几条实体行，完整列表走 `group.link`。行本身是带
 * `intent` 的跳转，不在队列里直接执行写操作 —— 退款、结算、回复仍由目标页
 * 的确认弹窗与权限校验完成。
 */
export function WorkQueue({
  groups,
  loading = false,
  error = null,
  emptyTitle = '当前没有待处理事项',
  emptyDescription = '告警、退款、对账与备份都在正常范围内。',
  className,
}: {
  groups: AdminWorkbenchGroup[];
  loading?: boolean;
  error?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}) {
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;

  if (loading && groups.length === 0) {
    return (
      <div
        className={cn('flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground', className)}
        aria-busy="true"
      >
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        正在加载待办…
      </div>
    );
  }

  if (error && groups.length === 0) {
    return (
      <div className={cn('flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-soft/40 px-4 py-4 text-sm text-danger-text', className)}>
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{error}</span>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className={cn('flex flex-col items-center rounded-lg border border-border bg-card px-4 py-8 text-center', className)}>
        <CheckCircle2 className="mb-2 size-6 text-success-text" aria-hidden />
        <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
        <p className="mt-1 text-xs text-muted-foreground">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {groups.map((group) => {
        const style = SEVERITY_STYLE[group.severity];
        const amount = currency(group.amountCents);
        return (
          <section
            key={group.key}
            className="overflow-hidden rounded-lg border border-border bg-card"
            aria-labelledby={`workbench-group-${group.key}`}
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/25 px-4 py-2.5">
              <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium', style.badge)}>
                {style.label}
              </span>
              <h3 id={`workbench-group-${group.key}`} className="text-sm font-semibold text-foreground">
                {group.label}
              </h3>
              <span className="text-sm font-semibold tabular-nums text-foreground">{group.count}</span>
              {amount && <span className="text-xs tabular-nums text-muted-foreground">涉及 {amount}</span>}
              <Link
                to={group.link}
                className="ml-auto inline-flex items-center gap-1 text-xs text-brand hover:underline"
              >
                查看全部
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>

            {group.items.length === 0 ? (
              <div className="px-4 py-3 text-xs text-muted-foreground">
                该类没有可展开的实体行，点击「查看全部」处理。
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={withReturnTo(item.target.path, returnTo)}
                      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent"
                    >
                      <span className={cn('size-1.5 shrink-0 rounded-full', style.dot)} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.subtitle}</span>
                      </span>
                      {item.meta.length > 0 && (
                        <span className="hidden shrink-0 items-center gap-2 text-xs text-muted-foreground xl:flex">
                          {item.meta.map((meta) => (
                            <span key={meta.label} className="whitespace-nowrap">
                              {meta.label}
                              <span
                                className={cn(
                                  'ml-1 font-medium text-foreground',
                                  meta.tone === 'danger' && 'text-danger-text',
                                  meta.tone === 'warn' && 'text-warn-text',
                                )}
                              >
                                {meta.value}
                              </span>
                            </span>
                          ))}
                        </span>
                      )}
                      <span className="shrink-0 text-xs text-brand">处理</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** 工作台分组标题旁的计数摘要，供概览页头复用 */
export function WorkQueueSummary({ groups }: { groups: AdminWorkbenchGroup[] }) {
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const critical = groups.filter((group) => group.severity === 'critical').length;
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <span>
        待办 <strong className="text-foreground">{total}</strong> 项
      </span>
      {critical > 0 && (
        <span className="inline-flex items-center gap-1 rounded bg-danger-soft px-1.5 py-0.5 font-medium text-danger-text">
          <AlertCircle className="size-3" aria-hidden />
          {critical} 类紧急
        </span>
      )}
    </span>
  );
}

/** 便于页面在队列上方放标题与操作 */
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
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
