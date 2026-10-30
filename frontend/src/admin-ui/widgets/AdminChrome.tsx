import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Inbox,
  Loader2,
  RotateCcw,
  X,
} from 'lucide-react';
import { Button } from '../../vendor/boardui/components/base/buttons/button';
import { Chip } from '../../vendor/boardui/components/base/badges/chip';
import { STATUS_META, type TagTone } from '../../components/admin/statusMeta';
import { cx } from '../lib/cn';
import { Drawer } from '../primitives/Drawer';
import { EmptyState, Result, Skeleton } from '../primitives';

/**
 * 后台共享控件（BoardUI 版）。
 *
 * ## 为什么重写的是「共享控件」而不是 29 个页面
 *
 * 29 个后台页面都从 `components/admin/PageHeader.tsx` 与 `AdminWidgets.tsx`
 * 取页头、筛选条、面板、状态标签、抽屉与确认条。页面自己只负责列定义与
 * 数据逻辑。把这层换成 BoardUI，29 页立刻获得统一的新外观，而页面内部的
 * 业务代码一行不动 —— 换壳的风险被收敛到一个文件里。
 *
 * 旧实现保留在 `components/admin/` 下，由 `flag.ts` 决定用哪一份。
 *
 * ## 入参签名刻意与旧版逐字一致
 *
 * 包括 `@deprecated` 的 `requireTyping` / `typingText`：签名一旦漂移，
 * 29 个调用点会陆续出现「只在新外壳失效」的怪异问题，回滚也会变成手工活。
 */

/* ────────────────────────── 页头与筛选 ────────────────────────── */

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
    <header className="mb-4 flex items-start gap-4 border-b border-border-table pb-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-[17px] font-semibold leading-6 text-text-primary">{title}</h1>
        {description && (
          <p className="mt-0.5 truncate text-xs text-text-tertiary" title={description}>
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function FilterBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border-table bg-white px-3 py-2.5',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FilterActions({ children }: { children: ReactNode }) {
  return <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>;
}

export interface AppliedFilter {
  key: string;
  label: string;
  onClear?: () => void;
}

/**
 * 已生效筛选回显。
 *
 * 与筛选栏里的草稿值分开：用户改了输入框但没点「查询」时，这里仍显示当前
 * 列表真正使用的条件。每条带单独清除，避免为了去掉一个条件整页重置。
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
    <div className="mb-3 flex flex-wrap items-center gap-1.5" aria-label="已生效的筛选条件">
      <span className="text-xs text-text-tertiary">已筛选</span>
      {items.map((item) => (
        <span
          key={item.key}
          title={item.label}
          className="inline-flex items-center gap-1 rounded-md bg-accent-50 px-1.5 py-0.5 text-xs text-accent-700"
        >
          <span className="max-w-[220px] truncate">{item.label}</span>
          {item.onClear && (
            <button
              type="button"
              aria-label={`清除筛选：${item.label}`}
              className="rounded text-accent-500 hover:text-accent-700"
              onClick={item.onClear}
            >
              <X className="size-3" aria-hidden />
            </button>
          )}
        </span>
      ))}
      {onClearAll && (
        <button
          type="button"
          className="ml-1 text-xs text-accent-600 underline-offset-2 hover:underline"
          onClick={onClearAll}
        >
          全部清除
        </button>
      )}
    </div>
  );
}

/* ────────────────────────── 面板与统计 ────────────────────────── */

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'danger' | 'warn';
}) {
  return (
    <div
      className={cx(
        'flex min-h-[96px] w-full flex-col justify-center rounded-xl border bg-white px-4 py-3',
        tone === 'danger' && 'border-rose-200 bg-rose-50/40',
        tone === 'warn' && 'border-amber-200 bg-amber-50/40',
        !tone && 'border-border-table',
      )}
    >
      <div className="text-xs text-text-tertiary">{label}</div>
      <div
        className={cx(
          'mt-1 text-[22px] font-semibold leading-7 tabular-nums',
          tone === 'danger' ? 'text-rose-700' : tone === 'warn' ? 'text-amber-700' : 'text-text-primary',
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] leading-4 text-text-tertiary">{hint}</div>}
    </div>
  );
}

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
    <section className="mb-3 rounded-xl border border-border-table bg-white">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
      >
        <ChevronDown
          className={cx('size-4 shrink-0 text-text-tertiary transition-transform', !isOpen && '-rotate-90')}
          aria-hidden
        />
        <span className="min-w-0 flex-1 text-sm font-medium text-text-primary">
          {title}
          {note && <span className="ml-2 text-xs font-normal text-text-tertiary">{note}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-text-tertiary">
          {isOpen ? extra : (collapsedHint ?? extra)}
        </span>
      </button>
      {isOpen && <div className="border-t border-border-table px-4 py-3">{children}</div>}
    </section>
  );
}

/* ────────────────────────── 状态标签 ────────────────────────── */

/** TagTone → Chip 颜色。success 用 lime 而不是 green：BoardUI 的颜色阶里 lime 才是正向态 */
const TONE_CHIP: Record<TagTone, 'lime' | 'rose' | 'yellow' | 'purple' | 'neutral'> = {
  success: 'lime',
  danger: 'rose',
  warn: 'yellow',
  brand: 'purple',
  muted: 'neutral',
};

export function StatusTag({
  status,
  label,
  tone,
}: {
  status: string;
  label?: string;
  tone?: TagTone;
}) {
  const item = STATUS_META[status] ?? { label: status, tone: 'muted' as TagTone };
  return (
    <Chip variant="caption" color={TONE_CHIP[tone ?? item.tone]}>
      {label ?? item.label}
    </Chip>
  );
}

/* ────────────────────────── 列表态 ────────────────────────── */

export function AdminEmpty({
  description,
  action,
}: {
  description: string;
  action?: ReactNode;
}) {
  return (
    <EmptyState icon={<Inbox aria-hidden />} title={description} action={action} />
  );
}

/** 保持布局稳定的骨架屏：空 div 撑不出真实列表高度，数据到达时会跳动 */
export function AdminListLoading({ tip = '加载中…' }: { tip?: string }) {
  return (
    <div className="flex flex-col gap-3 px-1 py-6" aria-busy="true" aria-live="polite">
      <Skeleton rows={5} />
      <p className="text-center text-xs text-text-tertiary">{tip}</p>
    </div>
  );
}

/** 列表页失败态：保留筛选条件，给出重试 */
export function AdminListError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <Result
      tone="error"
      title="加载失败"
      description={error}
      actions={
        <Button variant="secondary" size="small" leadingIcon={RotateCcw} onClick={onRetry}>
          重试
        </Button>
      }
    />
  );
}

/**
 * 刷新失败、但手上有上一次成功的数据。
 *
 * 用 `useAdminResource` / `useAdminList` 之后失败不清空数据 —— 好处是页面还能
 * 读，坏处是页面上每一处的数据都可能已经过期，而用户看不出来。这个条就是补上
 * 那句话，并就地给重试。
 */
export function AdminStaleError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div
      className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900"
      role="status"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <strong className="font-medium">刷新失败，下面是上一次成功获取的数据</strong>
        <div className="mt-0.5 text-amber-800">{error}</div>
      </div>
      <Button variant="ghost" size="xs" onClick={onRetry} className="shrink-0 text-amber-900">
        重试
      </Button>
    </div>
  );
}

/* ────────────────────────── 详情抽屉 ────────────────────────── */

/**
 * 详情抽屉。
 *
 * 懒加载：打开才请求，关闭清空 —— 避免打开列表时就为几十条记录各拉一次详情。
 * children 是渲染函数而非元素，这样详情数据到达前不会渲染出空壳。
 */
export function AdminDrawer<T>({
  open,
  title,
  onClose,
  fetcher,
  children,
  footer,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  fetcher: () => Promise<T>;
  children: (data: T) => ReactNode;
  footer?: (data: T) => ReactNode;
}) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const seq = useRef(0);
  /** 失败态的「重试」靠它重新触发拉取；抽屉的拉取只依赖 open，值不变不会重跑 */
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!open) {
      setData(null);
      setError(null);
      return;
    }
    const current = ++seq.current;
    setLoading(true);
    setError(null);
    fetcherRef
      .current()
      .then((next) => {
        if (current !== seq.current) return;
        setData(next);
      })
      .catch((next: unknown) => {
        if (current !== seq.current) return;
        setError(next instanceof Error ? next.message : '加载失败');
      })
      .finally(() => {
        if (current === seq.current) setLoading(false);
      });
  }, [open, retryNonce]);

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      width={720}
      footer={data && footer ? footer(data) : undefined}
    >
      {loading ? (
        <div className="flex flex-col gap-2 py-2">
          <Skeleton rows={6} />
          <p className="text-center text-xs text-text-tertiary">加载详情…</p>
        </div>
      ) : error ? (
        <Result
          tone="error"
          title="详情加载失败"
          description={
            <>
              <div>没能取回该条记录详情。</div>
              <div className="mt-1 text-text-tertiary">{error}</div>
            </>
          }
          actions={
            <Button
              variant="secondary"
              size="small"
              leadingIcon={RotateCcw}
              onClick={() => setRetryNonce((n) => n + 1)}
            >
              重试
            </Button>
          }
        />
      ) : data ? (
        children(data)
      ) : (
        <EmptyState title="暂无详情" />
      )}
    </Drawer>
  );
}

/* ────────────────────────── 高危操作确认 ────────────────────────── */

/**
 * 高危操作确认区（页面内，不使用弹窗）。
 *
 * 按产品要求去掉阻塞式确认弹窗：操作仍需要看影响面，但以页面底部的操作条
 * 承载。两条硬规则不能丢：
 *   1. 必须量化影响 —— 写「将删除相关数据」等于没写；
 *   2. 危险动作用 danger 标色，并把不可逆后果写在 description 里。
 */
export function ConfirmAction({
  open,
  title,
  description,
  impact,
  danger = false,
  confirmText = '确认',
  loading = false,
  confirmDisabled = false,
  extra,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  impact?: string[];
  danger?: boolean;
  /** @deprecated 不再要求输入确认词，保留入参仅为兼容旧调用 */
  requireTyping?: boolean;
  /** @deprecated 同上 */
  typingText?: string;
  confirmText?: string;
  loading?: boolean;
  confirmDisabled?: boolean;
  extra?: ReactNode;
  onCancel: () => void;
  onConfirm: (typed: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [loading, onCancel, open]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label={title}
      tabIndex={-1}
      className={cx(
        'sticky bottom-0 z-10 mt-3 rounded-xl border bg-white shadow-lg outline-none',
        danger ? 'border-rose-300' : 'border-border-table',
      )}
    >
      <div className="flex items-start gap-2 border-b border-border-table px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className={cx('text-sm font-semibold', danger ? 'text-rose-700' : 'text-text-primary')}>
            {title}
          </div>
          {description && <div className="mt-0.5 text-xs text-text-secondary">{description}</div>}
        </div>
        <Button variant="ghost" size="xs" onClick={onCancel} disabled={loading}>
          关闭
        </Button>
      </div>

      {(impact?.length || extra) && (
        <div className="flex flex-col gap-2 px-4 py-3">
          {impact && impact.length > 0 && (
            <div
              className={cx(
                'rounded-lg border px-3 py-2 text-xs',
                danger ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-900',
              )}
            >
              <div className="font-medium">影响范围</div>
              <ul className="mt-1 list-disc pl-4">
                {impact.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          {extra}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border-table px-4 py-2.5">
        <Button variant="secondary" size="small" onClick={onCancel} disabled={loading}>
          取消
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          size="small"
          disabled={loading || confirmDisabled}
          onClick={() => onConfirm('')}
        >
          {loading && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {confirmText}
        </Button>
      </div>
    </div>
  );
}
