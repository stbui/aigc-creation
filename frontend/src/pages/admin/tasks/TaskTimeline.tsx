import type { ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import { cn } from './utils';

export type StepState = 'done' | 'active' | 'pending' | 'failed' | 'cancelled';

/**
 * 状态流转时间线（横向）。
 *
 * 后端只落「创建」与终态两个可靠时间点，横向两三个节点比竖排更省垂直空间；
 * 节点用序号 / 对勾 / 叉双编码，颜色仍走语义令牌（完成绿、进行中品牌紫、
 * 未开始灰）。
 */
export function TaskTimeline({
  items,
}: {
  items: Array<{ title: string; state: StepState; description: ReactNode }>;
}) {
  return (
    <ol className="flex items-start">
      {items.map((node, index) => {
        const last = index === items.length - 1;
        return (
          <li key={index} className={cn('relative min-w-0', last ? 'flex-none' : 'flex-1 pr-6')}>
            {!last && (
              <span aria-hidden className="absolute top-[9.5px] right-2 left-6 h-px bg-border" />
            )}
            <span
              className={cn(
                'relative z-10 flex size-5 items-center justify-center rounded-full border text-[12px] tabular-nums',
                node.state === 'done'
                  ? 'border-success-text bg-success-soft text-success-text'
                  : node.state === 'failed'
                    ? 'border-danger-text bg-danger-soft text-danger-text'
                    : node.state === 'active'
                      ? 'border-brand bg-accent text-brand'
                      : 'border-border bg-muted text-muted-foreground',
              )}
            >
              {node.state === 'done' ? (
                <Check className="size-3" aria-hidden />
              ) : node.state === 'failed' || node.state === 'cancelled' ? (
                <X className="size-3" aria-hidden />
              ) : (
                index + 1
              )}
            </span>
            <div
              className={cn(
                'mt-2 text-sm',
                node.state === 'failed'
                  ? 'font-medium text-danger-text'
                  : node.state === 'done' || node.state === 'active'
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground',
              )}
            >
              {node.title}
            </div>
            <div className="mt-0.5 text-[12px] text-muted-foreground tabular-nums">
              {node.description}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
