import {
  ActionButton,
  AppliedFilters,
  ClearableField,
  FilterActions,
  FilterBar,
  SelectField,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import { STATUS_OPTIONS, TYPE_OPTIONS } from './constants';

interface CampaignFilterBarProps {
  keyword: string;
  onKeywordChange: (value: string) => void;
  type: string | undefined;
  onTypeChange: (value: string | undefined) => void;
  status: string | undefined;
  onStatusChange: (value: string | undefined) => void;
  appliedChips: AppliedFilter[];
  onApply: () => void;
  onReset: () => void;
}

/** 活动筛选条：只同步已生效的筛选，分页不进地址栏 */
export function CampaignFilterBar({
  keyword,
  onKeywordChange,
  type,
  onTypeChange,
  status,
  onStatusChange,
  appliedChips,
  onApply,
  onReset,
}: CampaignFilterBarProps) {
  return (
    <FilterBar>
      <ClearableField
        className="w-56"
        ariaLabel="按活动名称搜索"
        placeholder="活动名称"
        value={keyword}
        onChange={onKeywordChange}
        onEnter={onApply}
      />
      <SelectField
        className="w-32"
        ariaLabel="按类型筛选"
        placeholder="全部类型"
        clearLabel="全部类型"
        allowClear
        value={type}
        onChange={onTypeChange}
        options={TYPE_OPTIONS}
      />
      <SelectField
        className="w-32"
        ariaLabel="按状态筛选"
        placeholder="全部状态"
        clearLabel="全部状态"
        allowClear
        value={status}
        onChange={onStatusChange}
        options={STATUS_OPTIONS}
      />
      <FilterActions>
        <ActionButton variant="default" onClick={onApply}>
          查询
        </ActionButton>
        <ActionButton variant="secondary" onClick={onReset}>
          重置
        </ActionButton>
      </FilterActions>
      <AppliedFilters items={appliedChips} onClearAll={onReset} />
    </FilterBar>
  );
}
