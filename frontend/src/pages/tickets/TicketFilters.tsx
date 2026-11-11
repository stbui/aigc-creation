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
    <div className="ticket-filters" role="tablist" aria-label="按状态筛选工单">
      {FILTERS.map((f) => {
        const count = f.value === 'all' ? loaded : (counts[f.value] ?? 0);
        const active = filter === f.value;
        return (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`ticket-filter${active ? ' is-active' : ''}`}
            onClick={() => onChange(f.value)}
          >
            {f.label}
            <span className="ticket-filter-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
