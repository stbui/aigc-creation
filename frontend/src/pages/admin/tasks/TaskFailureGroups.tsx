import { AlertTriangle, X } from 'lucide-react';
import { cn, taskErrorLabel } from './utils';

/**
 * 近 24 小时失败任务的错误码聚合。
 *
 * 运营排障时先看「是不是同一类错」：同因失败往往一条线路 / 一个协议配置
 * 就能解释，按错误码筛出来再批量重试，比逐条打开详情快得多。
 */
export function TaskFailureGroups({
  groups,
  activeErrorCode,
  onSelect,
  onClear,
}: {
  groups: Array<{ errorCode: string; count: number }>;
  activeErrorCode?: string;
  onSelect: (errorCode: string) => void;
  onClear: () => void;
}) {
  if (groups.length === 0 && !activeErrorCode) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2">
      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <AlertTriangle className="size-3.5 text-warn-text" aria-hidden />
        近 24h 同因失败
      </span>
      {groups.map((group) => {
        const active = group.errorCode === activeErrorCode;
        return (
          <button
            key={group.errorCode}
            type="button"
            onClick={() => onSelect(group.errorCode)}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
              active
                ? 'border-brand/30 bg-accent text-brand'
                : 'border-border bg-card text-muted-foreground hover:bg-muted',
            )}
          >
            {taskErrorLabel(group.errorCode)}
            <span className="font-semibold tabular-nums">{group.count}</span>
          </button>
        );
      })}
      {activeErrorCode && (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={onClear}
        >
          <X className="size-3" aria-hidden />
          清除错误码
        </button>
      )}
    </div>
  );
}
