import {
  ActionButton,
  AppliedFilters,
  FilterActions,
  FilterBar,
  SelectField,
  TextField,
  type AppliedFilter,
} from './components';
import { BILLING_MODE_OPTIONS, REVIEW_OPTION, STATUS_OPTIONS } from './constants';

interface BillingFilterBarProps {
  status: string | undefined;
  onStatusChange: (value: string | undefined) => void;
  billingMode: string | undefined;
  onBillingModeChange: (value: string | undefined) => void;
  model: string;
  onModelChange: (value: string) => void;
  userId: string;
  onUserIdChange: (value: string) => void;
  taskId: string;
  onTaskIdChange: (value: string) => void;
  from: string;
  onFromChange: (value: string) => void;
  to: string;
  onToChange: (value: string) => void;
  appliedChips: AppliedFilter[];
  onApply: () => void;
  onReset: () => void;
}

/** 账单筛选条：状态跨「待核对」队列口径，见 `REVIEW_OPTION` */
export function BillingFilterBar({
  status,
  onStatusChange,
  billingMode,
  onBillingModeChange,
  model,
  onModelChange,
  userId,
  onUserIdChange,
  taskId,
  onTaskIdChange,
  from,
  onFromChange,
  to,
  onToChange,
  appliedChips,
  onApply,
  onReset,
}: BillingFilterBarProps) {
  return (
    <FilterBar>
      <SelectField
        ariaLabel="账单状态"
        value={status}
        options={[REVIEW_OPTION, ...STATUS_OPTIONS]}
        allowClear
        onChange={onStatusChange}
      />
      <SelectField
        ariaLabel="计费方式"
        value={billingMode}
        options={BILLING_MODE_OPTIONS}
        allowClear
        onChange={onBillingModeChange}
      />
      <TextField
        ariaLabel="模型编码"
        value={model}
        onChange={onModelChange}
        placeholder="前台模型编码"
        onEnter={onApply}
      />
      <TextField
        ariaLabel="用户 ID"
        value={userId}
        onChange={onUserIdChange}
        placeholder="用户 ID"
        onEnter={onApply}
      />
      <TextField
        ariaLabel="任务 ID"
        value={taskId}
        onChange={onTaskIdChange}
        placeholder="任务 ID"
        onEnter={onApply}
      />
      <TextField ariaLabel="开始日期" type="date" value={from} onChange={onFromChange} />
      <TextField ariaLabel="结束日期" type="date" value={to} onChange={onToChange} />
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
