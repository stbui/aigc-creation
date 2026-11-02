import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, RotateCcw } from 'lucide-react';

import { cn } from '../lib/cn';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '../components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../components/ui/empty';

/**
 * 后台页面骨架件：页头 / 面板 / 统计卡 / 保存条 / 空态与失败态。
 *
 * ## 层级表达
 *
 * 页头是**无容器的标题区**，下面的内容用**卡片**（`bg-card` + `shadow-card`）
 * 承载。层级靠留白与投影，不靠线条堆叠 —— 后台一屏常常三四块内容，
 * 每块都描边会让整页看起来像一张表格。
 *
 * ## 颜色
 *
 * 全部走 shadcn 语义令牌（`bg-card` / `text-foreground` / `text-muted-foreground`
 * / `border-border` / `shadow-card`），由 `styles/admin.css` 的 `@theme inline`
 * 桥接到 `global.css` 的既有令牌。改品牌色仍然只改 `global.css` 一处。
 */

/* ────────────────────────── 页头 ────────────────────────── */

/**
 * 页面标题区：标题 + 副标题在左，操作在右。
 *
 * 副标题不截断 —— 它通常是一句话说明「这一页在管什么」，切成两行也比
 * 被 `…` 吃掉好读。
 */
export function PageHeader({
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
 * `narrow` 把内容宽度限制到 760px —— 表单型页面限制阅读宽度，避免视线横跨
 * 半个屏幕；保存条用同一个值，竖向两条边才对得齐。
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
  narrow?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card
      data-testid="admin-panel"
      style={narrow ? { maxWidth: 760 } : undefined}
      className={cn(
        'mb-4 gap-0 overflow-hidden rounded-lg border-border bg-card py-0 shadow-card',
        className,
      )}
    >
      {(title || extra) && (
        <CardHeader className="flex flex-row items-center gap-3 border-b border-border px-4 py-3 pb-3">
          <div className="min-w-0 flex-1">
            {title && (
              /*
               * 用原生 `h2` 而不是 `CardTitle`（后者渲染 `div`）：面板标题是页面
               * 内的分区标题 —— 丢掉 heading 语义，读屏用户与 `getByRole('heading')`
               * 的导航都找不到这一块。
               */
              <h2 className="leading-[18px] font-semibold text-[13px] text-card-foreground">
                {title}
              </h2>
            )}
            {note && (
              <CardDescription className="mt-0.5 text-[12px]">{note}</CardDescription>
            )}
          </div>
          {extra && <div className="flex shrink-0 items-center gap-2">{extra}</div>}
        </CardHeader>
      )}
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

/* ────────────────────────── 统计卡 ────────────────────────── */

/**
 * 统计卡。
 *
 * 数字用 600 字重 + `tabular-nums`：等宽数字才能让一排卡片上的数字对齐成列，
 * 否则「1,284」和「312」的宽度差会让整排看起来参差。
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
    <Card
      data-testid="admin-stat-card"
      className={cn(
        'min-h-[92px] w-full justify-center gap-0 rounded-lg border-border bg-card px-4 py-3 shadow-card',
        tone === 'danger' && 'border-danger-soft bg-danger-soft/40',
        tone === 'warn' && 'border-warn-soft bg-warn-soft/40',
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 text-[22px] leading-7 font-semibold text-foreground tabular-nums',
          tone === 'danger' && 'text-danger-text',
          tone === 'warn' && 'text-warn-text',
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[12px] leading-4 text-muted-foreground">{hint}</div>}
    </Card>
  );
}

/* ────────────────────────── 保存条 ────────────────────────── */

/**
 * 页面底部的保存条。
 *
 * `narrow` 与窄版 `Panel` 用同一宽度 —— 面板 760、保存条全宽会让页面像
 * 两块没对齐的板。
 */
export function SaveBar({
  narrow = false,
  children,
  className,
}: {
  narrow?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-testid="admin-save-bar"
      style={narrow ? { maxWidth: 760 } : undefined}
      className={cn(
        'sticky bottom-0 z-10 mt-3 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-lg',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ────────────────────────── 列表态 ────────────────────────── */

/** 空态：说明为什么空 + 下一步能做什么，不留一片白。 */
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
    <Empty className="gap-2 px-6 py-14">
      <EmptyMedia variant="default" className="text-muted-foreground">
        <Inbox className="size-7" aria-hidden />
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

/** 首屏失败：没有任何可用数据，只能重试。 */
export function ListError({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <Empty className="gap-3 rounded-lg border border-border bg-card px-6 py-12 shadow-card">
      <EmptyMedia variant="default" className="rounded-full bg-danger-soft p-2 text-danger-text">
        <AlertTriangle className="size-5" aria-hidden />
      </EmptyMedia>
      <EmptyHeader className="gap-2">
        <EmptyTitle className="text-sm font-medium text-foreground">加载失败</EmptyTitle>
        <EmptyDescription className="max-w-md text-xs leading-5">{error}</EmptyDescription>
      </EmptyHeader>
      {/*
       * 没有 `onRetry` 就不渲染按钮 —— 一个点了没反应的按钮比没有更糟。
       */}
      {onRetry && (
        <EmptyContent className="max-w-none">
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw className="size-4" />
            重试
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}

/**
 * 刷新失败、但手上有上一次成功的数据。
 *
 * `useAdminList` / `useAdminResource` 失败不清空数据：好处是页面还能读，
 * 坏处是用户看不出「这页已经是旧的了」。这个条负责补上那句话。
 */
export function StaleError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <Alert
      role="status"
      className="mb-4 flex items-start gap-2 rounded-lg border-warn-soft bg-warn-soft px-3 py-2.5 text-xs text-warn-text"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <strong className="font-medium">刷新失败，下面是上一次成功获取的数据</strong>
        <div className="mt-0.5 opacity-80">{error}</div>
      </div>
      <Button variant="ghost" size="xs" onClick={onRetry} className="shrink-0 text-inherit">
        重试
      </Button>
    </Alert>
  );
}
