import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/** 页面底部保存条：窄版与窄版 Panel 同宽。 */
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
        'sticky bottom-0 z-10 mt-3 flex items-center gap-3 rounded-[8px] border border-radar-ink-200 bg-radar-surface px-4 py-2.5',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 抽屉 / 详情小节：上边框分隔，首个不画线。 */
export function DetailSection({
  title,
  note,
  className,
  children,
}: {
  title: ReactNode;
  note?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      data-testid="admin-detail-section"
      className={cn('border-t border-radar-ink-100 pt-3 first:border-t-0 first:pt-0', className)}
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-[13px] font-semibold text-radar-ink-900">{title}</h3>
        {note && (
          <span className="min-w-0 text-[12.5px] leading-5 text-radar-ink-400">{note}</span>
        )}
      </div>
      {children}
    </section>
  );
}

/** 表格上方批量操作条：count 为 0 时不渲染。 */
export function BatchBar({
  count,
  unit = '项',
  className,
  children,
}: {
  count: number;
  unit?: string;
  className?: string;
  children: ReactNode;
}) {
  if (count <= 0) return null;
  return (
    <div
      role="status"
      data-testid="admin-batch-bar"
      className={cn(
        'mb-3 flex flex-wrap items-center gap-2 rounded-[8px] border border-radar-ink-200 bg-radar-ink-100 px-3 py-2',
        className,
      )}
    >
      <span className="text-[13px] font-medium text-radar-ink-700">
        已选 {count} {unit}
      </span>
      {children}
    </div>
  );
}
