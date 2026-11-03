import {
  ActionButton,
  AppliedFilters,
  FilterActions,
  FilterBar,
  SelectField,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import { STATUS_OPTIONS } from './constants';

interface ProductFilterBarProps {
  status: 'active' | 'offline' | undefined;
  onStatusChange: (next: 'active' | 'offline' | undefined) => void;
  onRefresh: () => void;
  appliedChips: AppliedFilter[];
  onClearAll: () => void;
}

/** 商品筛选条：状态变更立即生效（同时写回地址栏） */
export function ProductFilterBar({
  status,
  onStatusChange,
  onRefresh,
  appliedChips,
  onClearAll,
}: ProductFilterBarProps) {
  return (
    <FilterBar>
      <SelectField
        className="w-32"
        ariaLabel="按状态筛选"
        placeholder="状态"
        allowClear
        clearLabel="全部状态"
        value={status}
        onChange={(value) => onStatusChange(value as 'active' | 'offline' | undefined)}
        options={STATUS_OPTIONS}
      />
      <FilterActions>
        <ActionButton variant="secondary" onClick={onRefresh}>
          刷新
        </ActionButton>
      </FilterActions>
      <AppliedFilters items={appliedChips} onClearAll={onClearAll} />
    </FilterBar>
  );
}
