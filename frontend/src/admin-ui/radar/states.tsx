/**
 * 列表态：空态 / 首屏失败 / 刷新失败。
 *
 * 三者原先都挤在 `blocks.tsx` 里，与页头、面板、统计卡混在一起；页面只关心
 * 「这页没有数据时显示什么」，所以单独成文件，`blocks.tsx` 回到纯骨架。
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, RotateCcw } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './Button';

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
