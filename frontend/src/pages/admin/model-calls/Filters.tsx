import {
  ActionButton,
  AppliedFilters,
  ClearableField,
  DateRangeField,
  FilterActions,
  FilterBar,
  SelectField,
  type AppliedFilter,
} from './components';
import {
  OPERATION_OPTIONS,
  REQUEST_KIND_OPTIONS,
  SOURCE_OPTIONS,
  STATUS_OPTIONS,
} from './constants';
import type { ModelCallFilterValues } from './types';

/**
 * 筛选条：条件平铺在一屏内，点「查询」或回车才提交。
 *
 * 下拉项同样不即时查询 —— 全部条件行为一致，才不会出现「改了下拉表格动了、
 * 改了输入框表格没动」这种两套语义。草稿本身由 `useModelCallFilters` 持有，
 * 这里只负责把改动回抛上去。
 */
export function Filters({
  draft,
  onChange,
  appliedChips,
  onApply,
  onReset,
}: {
  draft: ModelCallFilterValues;
  onChange: (patch: Partial<ModelCallFilterValues>) => void;
  appliedChips: AppliedFilter[];
  onApply: () => void;
  onReset: () => void;
}) {
  return (
    <FilterBar>
      <DateRangeField
        from={draft.from}
        to={draft.to}
        onChange={({ from, to }) => onChange({ from, to })}
        className="w-60"
      />
      <SelectField
        ariaLabel="调用状态"
        clearLabel="全部状态"
        value={draft.status}
        options={STATUS_OPTIONS}
        allowClear
        onChange={(value) => onChange({ status: value })}
        className="w-28"
      />
      <SelectField
        ariaLabel="请求类型"
        clearLabel="全部类型"
        value={draft.requestKind}
        options={REQUEST_KIND_OPTIONS}
        allowClear
        onChange={(value) => onChange({ requestKind: value })}
        className="w-32"
      />
      <SelectField
        ariaLabel="调用来源"
        clearLabel="全部来源"
        value={draft.source}
        options={SOURCE_OPTIONS}
        allowClear
        onChange={(value) => onChange({ source: value })}
        className="w-36"
      />
      <SelectField
        ariaLabel="调用操作"
        clearLabel="全部操作"
        value={draft.operation}
        options={OPERATION_OPTIONS}
        allowClear
        onChange={(value) => onChange({ operation: value })}
        className="w-52"
      />
      <ClearableField
        ariaLabel="任务 ID"
        value={draft.taskId}
        onChange={(value) => onChange({ taskId: value })}
        placeholder="任务 ID"
        onEnter={onApply}
        className="w-40"
      />
      <ClearableField
        ariaLabel="用户 ID"
        value={draft.userId}
        onChange={(value) => onChange({ userId: value })}
        placeholder="用户 ID"
        onEnter={onApply}
        className="w-40"
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
