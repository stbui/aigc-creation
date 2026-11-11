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

/** 筛选条上的四个下拉草稿。均未提交，点「查询」或回车才写进查询条件。 */
export interface TicketFilterDraft {
  status?: string;
  type?: string;
  priority?: string;
  assigneeId?: string;
}

const PRIORITY_OPTIONS = [
  { value: 'high', label: '高' },
  { value: 'normal', label: '中' },
  { value: 'low', label: '低' },
];

const ASSIGNEE_OPTIONS = [{ value: 'unassigned', label: '仅未指派' }];

/**
 * 工单列表的筛选条。
 *
 * 四个下拉与关键词**同一时机提交**：原先下拉是选中即 `setQuery`、关键词要按「查询」，
 * 同一条筛选条里两种时机，而「查询」按钮实际不管那四个下拉 —— 运营按了查询，
 * 以为是它生效的。现在全部走草稿，`onApply` 一次提交。
 */
export function TicketFilterBar({
  draft,
  onDraftChange,
  keyword,
  onKeywordChange,
  chips,
  onApply,
  onReset,
}: {
  draft: TicketFilterDraft;
  onDraftChange: (patch: Partial<TicketFilterDraft>) => void;
  keyword: string;
  onKeywordChange: (value: string) => void;
  chips: AppliedFilter[];
  onApply: () => void;
  onReset: () => void;
}) {
  return (
    <FilterBar>
      <SelectField
        className="w-32"
        ariaLabel="按状态筛选"
        allowClear
        clearLabel="全部状态"
        value={draft.status}
        onChange={(value) => onDraftChange({ status: value })}
        options={STATUS_OPTIONS}
      />
      <SelectField
        className="w-32"
        ariaLabel="按类型筛选"
        allowClear
        clearLabel="全部类型"
        value={draft.type}
        onChange={(value) => onDraftChange({ type: value })}
        options={TYPE_OPTIONS}
      />
      <SelectField
        className="w-32"
        ariaLabel="按优先级筛选"
        allowClear
        clearLabel="全部优先级"
        value={draft.priority}
        onChange={(value) => onDraftChange({ priority: value })}
        options={PRIORITY_OPTIONS}
      />
      <SelectField
        className="w-32"
        ariaLabel="按归属筛选"
        allowClear
        clearLabel="全部归属"
        value={draft.assigneeId}
        onChange={(value) => onDraftChange({ assigneeId: value })}
        options={ASSIGNEE_OPTIONS}
      />
      <ClearableField
        className="w-56"
        placeholder="工单号 / 标题 / 正文"
        ariaLabel="工单号 / 标题 / 正文"
        value={keyword}
        onChange={onKeywordChange}
        onEnter={onApply}
      />
      <FilterActions>
        <ActionButton variant="default" onClick={onApply}>
          查询
        </ActionButton>
        <ActionButton variant="secondary" onClick={onReset}>
          重置
        </ActionButton>
      </FilterActions>
      <AppliedFilters items={chips} onClearAll={onReset} />
    </FilterBar>
  );
}
