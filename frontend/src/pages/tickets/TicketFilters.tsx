import type { TicketStatus } from '../../types/api';
import { FILTERS, type TicketFilterValue } from './constants';

/**
 * 工单状态筛选条。
 *
 * 「全部」档位显示已加载条数，其余档位显示后端 `statusCounts`（全量统计），
 * 与卡片上的状态一一对应。本组件只负责渲染与回传选中档位。
 */
export interface TicketFiltersProps {
  filter: TicketFilterValue;
  counts: Partial<Record<TicketStatus, number>>;
  /** 已加载条数（「全部」档位的计数） */
  loaded: number;
  onChange: (value: TicketFilterValue) => void;
}

export function TicketFilters({ filter, counts, loaded, onChange }: TicketFiltersProps) {
  return (
    <div
      className="mb-4 flex flex-wrap gap-2 max-[640px]:flex-nowrap max-[640px]:flex-nowrap max-[640px]:overflow-x-auto max-[640px]:pb-1 max-[640px]:[scrollbar-width:thin]"
      role="group"
      aria-label="按状态筛选工单"
    >
      {FILTERS.map((f) => {
        const count = f.value === 'all' ? loaded : (counts[f.value] ?? 0);
        const active = filter === f.value;
        return (
          <button
            key={f.value}
            type="button"
            aria-pressed={active}
            className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] leading-none transition-colors max-[640px]:shrink-0 ${
              active
                ? 'border-brand-bg bg-brand-bg font-semibold text-brand'
                : 'border-border bg-card text-muted-foreground hover:border-[color-mix(in_srgb,var(--brand)_35%,var(--border))] hover:text-foreground'
            }`}
            onClick={() => onChange(f.value)}
          >
            {f.label}
            <span
              className={`text-xs tabular-nums ${active ? 'text-brand' : 'text-muted-foreground'}`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}