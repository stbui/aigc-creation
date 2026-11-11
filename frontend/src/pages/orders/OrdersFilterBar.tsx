import { FILTERS, type FilterValue } from './constants';

/**
 * 订单状态筛选条。
 *
 * 计数来自后端 `statusCounts`（全量真实数量），不是对已加载页做本地统计 ——
 * 后者会随着分页把数量越报越少。本组件只负责渲染与回传选中档位，
 * 数据仍由 `page.tsx` 持有。
 */
export interface OrdersFilterBarProps {
  filter: FilterValue;
  counts: Record<FilterValue, number>;
  onChange: (value: FilterValue) => void;
}

export function OrdersFilterBar({ filter, counts, onChange }: OrdersFilterBarProps) {
  return (
    <div className="order-filters" role="tablist" aria-label="按状态筛选订单">
      {FILTERS.map((f) => {
        const active = filter === f.value;
        return (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`order-filter${active ? ' is-active' : ''}`}
            onClick={() => onChange(f.value)}
          >
            {f.label}
            <span className="order-filter-count">{counts[f.value]}</span>
          </button>
        );
      })}
    </div>
  );
}
