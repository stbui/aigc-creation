import { Search } from 'lucide-react';
import {
  ActionButton,
  AppliedFilters,
  ClearableField,
  FilterActions,
  FilterBar,
  SelectField,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import { GRANT_TYPE_FILTER_OPTIONS, STATUS_OPTIONS } from './constants';

interface ProductFilterBarProps {
  q: string;
  onQChange: (next: string) => void;
  status: 'active' | 'offline' | undefined;
  onStatusChange: (next: 'active' | 'offline' | undefined) => void;
  grantType: 'immediate' | 'manual' | undefined;
  onGrantTypeChange: (next: 'immediate' | 'manual' | undefined) => void;
  onReset: () => void;
  hasFilter: boolean;
  appliedChips: AppliedFilter[];
}

/**
 * 商品筛选条：关键词 / 状态 / 发放方式。
 *
 * 商品总量是几十条量级，筛选在客户端即时完成 —— 改一个条件不必等一次请求，
 * 「正好搜到那一件」比「点了查询才生效」更顺手。已生效条件回显成 chip，
 * 与调用记录页保持同一套「筛选条 + chip」心智。
 */
export function ProductFilterBar({
  q,
  onQChange,
  status,
  onStatusChange,
  grantType,
  onGrantTypeChange,
  onReset,
  hasFilter,
  appliedChips,
}: ProductFilterBarProps) {
  return (
    <FilterBar>
      <ClearableField
        className="w-64"
        ariaLabel="搜索商品"
        placeholder="商品名称 / SKU"
        icon={<Search className="size-3.5" aria-hidden />}
        value={q}
        onChange={onQChange}
      />
      <SelectField
        className="w-32"
        ariaLabel="按状态筛选"
        placeholder="全部状态"
        allowClear
        clearLabel="全部状态"
        value={status}
        onChange={(value) => onStatusChange(value as 'active' | 'offline' | undefined)}
        options={STATUS_OPTIONS}
      />
      <SelectField
        className="w-40"
        ariaLabel="按发放方式筛选"
        placeholder="全部发放方式"
        allowClear
        clearLabel="全部发放方式"
        value={grantType}
        onChange={(value) => onGrantTypeChange(value as 'immediate' | 'manual' | undefined)}
        options={GRANT_TYPE_FILTER_OPTIONS}
      />
      <FilterActions>
        <ActionButton variant="secondary" size="sm" onClick={onReset} disabled={!hasFilter}>
          重置
        </ActionButton>
      </FilterActions>
      <AppliedFilters items={appliedChips} onClearAll={onReset} />
    </FilterBar>
  );
}
