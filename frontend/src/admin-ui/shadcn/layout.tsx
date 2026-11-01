import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, RotateCcw } from 'lucide-react';

import { cn } from '../lib/cn';
import { Button } from '../components/ui';

/**
 * shadcn 版页面骨架（2026-11-01）。
 *
 * ## 与 `admin-ui/widgets/AdminChrome.tsx` 的关系
 *
 * 两套并存，**按页面边界切**。旧骨架（BoardUI 版）服务于 35 个既有页面，
 * 保留不动；新写的页面用这一套。
 *
 * ## 形态差异（为什么值得换）
 *
 * - 旧 `PageHeader` 用**发丝线**分隔页头与内容，页头本身没有容器。
 * - 旧 `Panel` 是「白底 + 一圈描边」的方盒子，标题栏与内容区之间只有一条线。
 *
 * 新的一套改成：页头是**带底色的标题区**，内容区是**卡片**（`shadow-card`，
 * 弱投影代替描边），层级靠**留白与投影**表达，不靠线条堆叠。视觉上更接近
 * 主流后台产品（Linear / Vercel / shadcn 官方示例）。
 */

/* ────────────────────────── 页头 ────────────────────────── */

/**
 * 页面标题区。
 *
 * 标题 + 副标题在左，操作在右。副标题不截断 —— 旧实现用 `truncate`，
 * 长描述被切掉后用户看不到「这句在说谁」。
 */
export function PageTitle({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && (
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ────────────────────────── 面板 ────────────────────────── */

/**
 * 内容面板（卡片形）。
 *
 * `isNarrow` 把内容宽度限制到 760px 并左对齐 —— 表单型页面限制阅读宽度，
 * 避免视线横跨半个屏幕。与旧 `Panel` 的窄版口径一致。
 */
export function Panel({
  title,
  note,
  extra,
  isNarrow = false,
  children,
  className,
}: {
  title?: ReactNode;
  note?: ReactNode;
  extra?: ReactNode;
  /** 窄版：表单型页面限制内容宽度 */
  isNarrow?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      data-testid="admin-panel"
      style={isNarrow ? { maxWidth: 760 } : undefined}
      className={cn(
        'mb-4 overflow-hidden rounded-xl border border-border bg-card shadow-card',
        className,
      )}
    >
      {(title || extra) && (
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            {title && (
              <h2 className="text-[13px] font-semibold leading-[18px] text-card-foreground">
                {title}
              </h2>
            )}
            {note && <p className="mt-0.5 text-[11.5px] text-muted-foreground">{note}</p>}
          </div>
          {extra && <div className="flex shrink-0 items-center gap-2">{extra}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/* ────────────────────────── 统计卡 ────────────────────────── */

/**
 * 统计卡。
 *
 * 数字用 600 字重 + `tabular-nums`：统计数字需要**等宽**才能上下对齐成列，
 * 否则「1,284」和「312」的宽度差会让一排数字看着参差。
 */
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
      className={cn(
        'flex min-h-[92px] w-full flex-col justify-center rounded-xl border border-border bg-card px-4 py-3 shadow-card',
        tone === 'danger' && 'border-danger-soft bg-danger-soft/40',
        tone === 'warn' && 'border-warn-soft bg-warn-soft/40',
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 text-[22px] font-semibold leading-7 tabular-nums text-foreground',
          tone === 'danger' && 'text-danger-text',
          tone === 'warn' && 'text-warn-text',
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{hint}</div>}
    </div>
  );
}

/* ────────────────────────── 保存条 ────────────────────────── */

/**
 * 页面底部的保存条。
 *
 * 窄版表单页（设置页）的面板宽 760px，保存条若跟着内容区全宽，就会比上方面板
 * 宽出一截，页面看起来像「两块没对齐的板」。`narrow` 用与窄版 `Panel` 相同的
 * 宽度与左对齐方式，保证竖向是一条边。
 */
export function SaveBar({
  narrow = false,
  children,
}: {
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-testid="admin-save-bar"
      style={narrow ? { maxWidth: 760 } : undefined}
      className="sticky bottom-0 z-10 mt-3 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 shadow-lg"
    >
      {children}
    </div>
  );
}

/* ────────────────────────── 列表态 ────────────────────────── */

/** 空态：说明为什么空 + 下一步能做什么，不留一片白 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="text-muted-foreground">
        <Inbox className="size-7" aria-hidden />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="max-w-md text-xs leading-5 text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function AdminEmpty({
  description,
  action,
}: {
  description: string;
  action?: ReactNode;
}) {
  return <EmptyState title={description} action={action} />;
}

/** 列表页失败态：保留筛选条件，给出重试 */
export function AdminListError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-6 py-12 text-center shadow-card">
      <div className="rounded-full bg-danger-soft p-2 text-danger-text">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-medium text-foreground">加载失败</p>
      <p className="max-w-md text-xs leading-5 text-muted-foreground">{error}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCcw className="size-4" />
        重试
      </Button>
    </div>
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
      className="mb-4 flex items-start gap-2 rounded-xl border border-warn-soft bg-warn-soft px-3 py-2.5 text-xs text-warn-text"
      role="status"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <strong className="font-medium">刷新失败，下面是上一次成功获取的数据</strong>
        <div className="mt-0.5 opacity-80">{error}</div>
      </div>
      <Button variant="ghost" size="xs" onClick={onRetry} className="shrink-0">
        重试
      </Button>
    </div>
  );
}
