import {
  ActionButton,
  AppliedFilters,
  ClearableField,
  FilterActions,
  FilterBar,
  SelectField,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import { BACKEND_OPTIONS, KIND_OPTIONS, STATUS_OPTIONS } from './constants';

interface AssetFilterBarProps {
  keyword: string;
  kind: string | undefined;
  status: string | undefined;
  backend: string | undefined;
  appliedChips: AppliedFilter[];
  onKeywordChange: (value: string) => void;
  onKindChange: (value: string | undefined) => void;
  onStatusChange: (value: string | undefined) => void;
  onBackendChange: (value: string | undefined) => void;
  onApply: () => void;
  onReset: () => void;
}

/** 素材筛选条：保留草稿值，点击查询后才写入列表查询参数。 */
export function AssetFilterBar({
  keyword,
  kind,
  status,
  backend,
  appliedChips,
  onKeywordChange,
  onKindChange,
  onStatusChange,
  onBackendChange,
  onApply,
  onReset,
}: AssetFilterBarProps) {
  return (
    <FilterBar>
      <ClearableField
        className="w-56"
        placeholder="ID / 能力关键词"
        ariaLabel="按素材 ID 或能力关键词筛选"
        value={keyword}
        onChange={onKeywordChange}
        onEnter={onApply}
      />
      <SelectField
        className="w-32"
        ariaLabel="按类型筛选"
        placeholder="类型"
        allowClear
        clearLabel="全部类型"
        value={kind}
        onChange={onKindChange}
        options={KIND_OPTIONS}
      />
      <SelectField
        className="w-32"
        ariaLabel="按状态筛选"
        placeholder="状态"
        allowClear
        clearLabel="全部状态"
        value={status}
        onChange={onStatusChange}
        options={STATUS_OPTIONS}
      />
      <SelectField
        className="w-36"
        ariaLabel="按存储后端筛选"
        placeholder="存储后端"
        allowClear
        clearLabel="全部存储后端"
        value={backend}
        onChange={onBackendChange}
        options={BACKEND_OPTIONS}
      />
      <FilterActions>
        <ActionButton variant="default" onClick={onApply}>
          查询
        </ActionButton>
        <ActionButton
          variant="secondary"
          onClick={onReset}
          disabled={appliedChips.length === 0 && !keyword && !kind && !status && !backend}
        >
          重置
        </ActionButton>
      </FilterActions>
      <AppliedFilters items={appliedChips} onClearAll={onReset} />
    </FilterBar>
  );
}
