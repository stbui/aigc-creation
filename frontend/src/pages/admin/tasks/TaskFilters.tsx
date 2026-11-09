import {
  ActionButton,
  AppliedFilters,
  ClearableField,
  FilterActions,
  FilterBar,
  SelectField,
  TextField,
  type AppliedFilter,
  type SelectFieldOption,
} from '~/admin-ui/primitives';
import { STATUS_OPTIONS } from './constants';

interface TaskFiltersProps {
  status?: string;
  onStatusChange: (value: string | undefined) => void;
  capability?: string;
  onCapabilityChange: (value: string | undefined) => void;
  owner: string;
  onOwnerChange: (value: string) => void;
  project: string;
  onProjectChange: (value: string) => void;
  errorCode: string;
  onErrorCodeChange: (value: string) => void;
  from: string;
  onFromChange: (value: string) => void;
  to: string;
  onToChange: (value: string) => void;
  capabilityOptions: SelectFieldOption[];
  appliedChips: AppliedFilter[];
  onApply: () => void;
  onReset: () => void;
}

/** 任务列表的筛选条；只维护受控输入并转发查询动作。 */
export function TaskFilters({
  status,
  onStatusChange,
  capability,
  onCapabilityChange,
  owner,
  onOwnerChange,
  project,
  onProjectChange,
  errorCode,
  onErrorCodeChange,
  from,
  onFromChange,
  to,
  onToChange,
  capabilityOptions,
  appliedChips,
  onApply,
  onReset,
}: TaskFiltersProps) {
  return (
    <FilterBar>
      <SelectField
        className="w-28"
        ariaLabel="按状态筛选"
        placeholder="状态"
        allowClear
        value={status}
        onChange={onStatusChange}
        options={STATUS_OPTIONS}
      />
      <SelectField
        className="w-28"
        ariaLabel="按能力筛选"
        placeholder="能力"
        allowClear
        value={capability}
        onChange={onCapabilityChange}
        options={capabilityOptions}
      />
      {/*
       * 用户/项目用 id 直填而非下拉：
       * 后台用户可能有成千上万，下拉搜索反而不如粘贴 id 快
       * （运营手上通常正有从工单/日志里复制的 id）。
       */}
      <ClearableField
        className="w-32"
        ariaLabel="按用户 ID 筛选"
        placeholder="用户 ID"
        value={owner}
        onChange={onOwnerChange}
        onEnter={onApply}
      />
      <ClearableField
        className="w-32"
        ariaLabel="按项目 ID 筛选"
        placeholder="项目 ID"
        value={project}
        onChange={onProjectChange}
        onEnter={onApply}
      />
      <ClearableField
        className="w-32"
        ariaLabel="按错误码筛选"
        placeholder="错误码"
        value={errorCode}
        onChange={onErrorCodeChange}
        onEnter={onApply}
      />
      <TextField
        className="w-44"
        type="datetime-local"
        ariaLabel="开始时间"
        value={from}
        onChange={onFromChange}
        onEnter={onApply}
      />
      <TextField
        className="w-44"
        type="datetime-local"
        ariaLabel="结束时间"
        value={to}
        onChange={onToChange}
        onEnter={onApply}
      />
      <FilterActions>
        <ActionButton variant="default" size="sm" onClick={onApply}>
          查询
        </ActionButton>
        <ActionButton variant="secondary" size="sm" onClick={onReset}>
          重置
        </ActionButton>
      </FilterActions>
      <AppliedFilters items={appliedChips} onClearAll={onReset} />
    </FilterBar>
  );
}
