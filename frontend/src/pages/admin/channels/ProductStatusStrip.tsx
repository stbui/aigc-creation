import { cn } from '../../../admin-ui/lib/cn';
import { Toggle } from '~/admin-ui/primitives';
import type { AllModelsStatusFilter } from './constants';
import { PRODUCT_STATE_META, type ProductState } from './utils';

export interface ProductStatusCounts {
  available: number;
  unpriced: number;
  unconfigured: number;
  disabled: number;
  cooling: number;
}

interface StatusItem {
  state: ProductState | 'cooling';
  value: AllModelsStatusFilter;
  label: string;
  count: number;
  dot: string;
}

/**
 * 商品台账的顶部状态条。
 *
 * 数字从全量商品派生，不受当前筛选影响；点一格只套一个状态筛选，再点一次
 * 取消。它回答的是“现在还有多少商品没准备好”，而不是再摆一排统计卡。
 */
export function ProductStatusStrip({
  counts,
  active,
  onChange,
}: {
  counts: ProductStatusCounts;
  active: AllModelsStatusFilter;
  onChange: (next: AllModelsStatusFilter) => void;
}) {
  const items: StatusItem[] = [
    {
      state: 'available',
      value: 'enabled',
      label: PRODUCT_STATE_META.available.label,
      count: counts.available,
      dot: 'bg-success-text',
    },
    {
      state: 'unpriced',
      value: 'unpriced',
      label: PRODUCT_STATE_META.unpriced.label,
      count: counts.unpriced,
      dot: 'bg-warn-text',
    },
    {
      state: 'unconfigured',
      value: 'unconfigured',
      label: PRODUCT_STATE_META.unconfigured.label,
      count: counts.unconfigured,
      dot: 'bg-warn-text',
    },
    {
      state: 'disabled',
      value: 'disabled',
      label: PRODUCT_STATE_META.disabled.label,
      count: counts.disabled,
      dot: 'bg-muted-foreground',
    },
    {
      state: 'cooling',
      value: 'cooling',
      label: '冷却中',
      count: counts.cooling,
      dot: 'bg-danger-text',
    },
  ];

  return (
    <div
      data-testid="product-status-strip"
      className="flex flex-wrap items-center gap-1.5"
      aria-label="商品状态汇总"
    >
      {items.map((item) => {
        const selected = active === item.value;
        return (
          <Toggle
            key={item.value}
            data-kind={item.state}
            variant="outline"
            size="sm"
            pressed={selected}
            onPressedChange={() => onChange(selected ? 'all' : item.value)}
            className={cn(
              'h-auto min-w-0 gap-1.5 rounded-lg border-border bg-card px-2.5 py-1 text-[12px] leading-4 font-normal',
              'text-muted-foreground hover:bg-muted hover:text-muted-foreground',
              'data-[state=on]:border-brand/30 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground',
              item.count === 0 && !selected && 'opacity-60',
            )}
          >
            <span className={cn('size-1.5 rounded-full', item.dot)} aria-hidden />
            <span>{item.label}</span>
            <span className="tabular-nums font-medium text-foreground">{item.count}</span>
          </Toggle>
        );
      })}
    </div>
  );
}
