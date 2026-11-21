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
    <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="按状态筛选订单">
      {FILTERS.map((f) => {
        const active = filter === f.value;
        return (
          <button
            key={f.value}
            type="button"
            aria-pressed={active}
            className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] leading-none transition-colors ${
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
              {counts[f.value]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
