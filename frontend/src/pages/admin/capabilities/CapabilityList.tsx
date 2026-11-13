import { StaleError, StatusTag } from '~/admin-ui/primitives';
import type { AdminCapabilityControl } from '../../../types/api';
import { ADMIN_RUNTIME_LABELS } from './constants';
import { runtimeTone } from './utils';

/** 左侧能力清单；筛选由页面完成，这里只负责选择与运行结论。 */
export function CapabilityList({
  rows,
  loading,
  error,
  selectedId,
  onSelect,
  onRetry,
}: {
  rows: AdminCapabilityControl[];
  loading: boolean;
  error: string | null;
  selectedId: string;
  onSelect: (id: string) => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-foreground">能力清单</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            按能力查看线路、售价与影响面
          </div>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{rows.length} 项</span>
      </div>
      {error && <StaleError error={error} onRetry={onRetry} />}
      {loading && rows.length === 0 && (
        <div className="py-6 text-center text-xs text-muted-foreground">读取中…</div>
      )}
      <div className="flex max-h-[680px] flex-col gap-1 overflow-auto">
        {rows.map((row) => (
          <button
            key={row.capabilityId}
            type="button"
            data-testid="admin-capability-card"
            aria-pressed={row.capabilityId === selectedId}
            onClick={() => onSelect(row.capabilityId)}
            className={`rounded-md border px-2.5 py-2 text-left transition-colors ${
              row.capabilityId === selectedId
                ? 'border-brand bg-brand-bg'
                : 'border-border hover:bg-accent'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-foreground">{row.name}</span>
              <StatusTag
                status={row.runtime.effective}
                tone={runtimeTone(row.runtime.effective)}
                label={ADMIN_RUNTIME_LABELS[row.runtime.effective] ?? row.runtime.effective}
              />
            </div>
            <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
              <span className="font-mono">{row.capabilityId}</span>
              {' · '}
              {row.groupName}
            </div>
          </button>
        ))}
        {!loading && rows.length === 0 && (
          <div className="py-6 text-center text-xs text-muted-foreground">没有匹配的能力</div>
        )}
      </div>
    </div>
  );
}
