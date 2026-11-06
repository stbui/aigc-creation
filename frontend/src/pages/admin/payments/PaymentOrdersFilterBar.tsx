import {
  ActionButton,
  ExportCsvButton,
  AppliedFilters,
  FilterActions,
  FilterBar,
  SelectField,
  TextField,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import { ORDER_PROVIDERS, PAYMENT_ORDER_STATUS_OPTIONS, PAYMENT_ORDER_TIME_FIELD_OPTIONS } from './constants';
import type { PaymentDisplayStatus } from '../../../types/payment';

export interface PaymentOrderFilterValues {
  keyword: string;
  status?: PaymentDisplayStatus;
  providerId?: string;
  timeField?: string;
  from: string;
  to: string;
}

export type PaymentOrderFilterKey = keyof PaymentOrderFilterValues;

/** 支付订单筛选条：草稿值与查询动作分开，导出按钮始终使用已应用条件。 */
export function PaymentOrdersFilterBar({
  values,
  onChange,
  onApply,
  onReset,
  onExport,
  exportDisabled,
  appliedChips,
}: {
  values: PaymentOrderFilterValues;
  onChange: (key: PaymentOrderFilterKey, value: string | undefined) => void;
  onApply: () => void;
  onReset: () => void;
  onExport: () => void;
  exportDisabled: boolean;
  appliedChips: AppliedFilter[];
}) {
  return (
    <FilterBar>
      <TextField
        value={values.keyword}
        onChange={(value) => onChange('keyword', value)}
        placeholder="搜索名称、用户名、邮箱、订单号"
        className="w-[240px]"
        onEnter={onApply}
      />
      <SelectField
        value={values.status}
        onChange={(value) => onChange('status', value)}
        options={PAYMENT_ORDER_STATUS_OPTIONS}
        allowClear
        className="w-[130px]"
        ariaLabel="订单状态"
      />
      <SelectField
        value={values.providerId}
        onChange={(value) => onChange('providerId', value)}
        options={ORDER_PROVIDERS}
        allowClear
        className="w-[120px]"
        ariaLabel="支付渠道"
      />
      <SelectField
        value={values.timeField}
        onChange={(value) => onChange('timeField', value)}
        options={PAYMENT_ORDER_TIME_FIELD_OPTIONS}
        allowClear
        className="w-[130px]"
        ariaLabel="时间口径"
      />
      <TextField
        type="date"
        value={values.from}
        onChange={(value) => onChange('from', value)}
        className="w-[140px]"
        ariaLabel="起始日期"
      />
      <TextField
        type="date"
        value={values.to}
        onChange={(value) => onChange('to', value)}
        className="w-[140px]"
        ariaLabel="截止日期"
      />
      <FilterActions>
        <ActionButton onClick={onApply}>查询</ActionButton>
        <ActionButton onClick={onReset}>重置</ActionButton>
        <ExportCsvButton size="default" onExport={onExport} disabled={exportDisabled} />
      </FilterActions>
      <AppliedFilters items={appliedChips} />
    </FilterBar>
  );
}
