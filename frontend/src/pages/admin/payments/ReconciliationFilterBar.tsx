import {
  ActionButton,
  ExportCsvButton,
  AppliedFilters,
  DateRangeField,
  FilterActions,
  FilterBar,
  SelectField,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import { RECONCILIATION_PROVIDERS } from './constants';

export interface ReconciliationFilterValues {
  providerId?: string;
  status?: string;
  from: string;
  to: string;
}

export type ReconciliationFilterKey = keyof ReconciliationFilterValues;

/** 对账运行列表筛选条；导出固定使用已应用的 URL 条件。 */
export function ReconciliationFilterBar({
  values,
  statusOptions,
  onChange,
  onApply,
  onReset,
  onExport,
  exportDisabled,
  appliedChips,
}: {
  values: ReconciliationFilterValues;
  statusOptions: Array<{ value: string; label: string }>;
  onChange: (key: ReconciliationFilterKey, value: string | undefined) => void;
  onApply: () => void;
  onReset: () => void;
  onExport: () => void;
  exportDisabled: boolean;
  appliedChips: AppliedFilter[];
}) {
  return (
    <FilterBar>
      <SelectField
        value={values.providerId}
        onChange={(value) => onChange('providerId', value)}
        options={RECONCILIATION_PROVIDERS}
        allowClear
        className="w-[130px]"
        ariaLabel="筛选渠道"
      />
      <SelectField
        value={values.status}
        onChange={(value) => onChange('status', value)}
        options={statusOptions}
        allowClear
        className="w-[120px]"
        ariaLabel="筛选状态"
      />
      <DateRangeField
        from={values.from}
        to={values.to}
        onChange={({ from, to }) => {
          onChange('from', from);
          onChange('to', to);
        }}
        className="w-[280px]"
        ariaLabel="筛选日期范围"
      />
      <FilterActions>
        <ActionButton onClick={onApply}>筛选</ActionButton>
        <ActionButton onClick={onReset}>重置</ActionButton>
        <ExportCsvButton size="default" onExport={onExport} disabled={exportDisabled} />
      </FilterActions>
      <AppliedFilters items={appliedChips} />
    </FilterBar>
  );
}
