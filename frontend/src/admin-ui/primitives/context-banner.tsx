import { Link } from 'react-router-dom';
import { ArrowLeft, Link2 } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * 跨页上下文条。
 *
 * 目标页用它告诉用户「从哪里来、准备做什么、怎么回去」。`returnTo` 已在
 * `lib/admin-context-link.ts` 做过站内白名单校验，这里只负责展示。
 */
export function ContextBanner({
  title,
  detail,
  returnTo,
  returnLabel = '返回来源',
  className,
}: {
  title: string;
  detail?: string;
  returnTo?: string | null;
  returnLabel?: string;
  className?: string;
}) {
  if (!title && !returnTo) return null;
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border border-brand/20 bg-accent px-3.5 py-2.5 text-sm',
        className,
      )}
      data-testid="admin-context-banner"
    >
      <Link2 className="size-4 shrink-0 text-brand" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-medium text-foreground">{title}</span>
        {detail && <span className="ml-2 text-xs text-muted-foreground">{detail}</span>}
      </span>
      {returnTo && (
        <Link
          to={returnTo}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {returnLabel}
        </Link>
      )}
    </div>
  );
}
