import {
  ActionButton,
  AppliedFilters,
  DateField,
  ExportCsvButton,
  FilterActions,
  FilterBar,
  SelectField,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import type { ReconciliationFilterKey, ReconciliationFilterValues } from './constants';

/**
 * 对账工具栏：渠道 + 服务商实例 + 账单日 + 状态是页面**唯一**一套条件。
 *
 * 渠道与账单日同时喂给「执行对账」和列表筛选 —— 早期版本在执行区与筛选条各
 * 放一组渠道 + 日期，同一屏出现两个渠道下拉、两个日期控件，改了一处忘了另一处
 * 就会「按 A 的渠道查询、按 B 的渠道执行」。执行成功后由页面把当前条件写入
 * 已生效筛选，列表随即切到本次执行的渠道与账单日。
 *
 * 日期是单日账单（对账的最小粒度），列表查询时按 `from = to` 展开成区间。
 */
export function ReconciliationToolbar({
  values,
  providerOptions,
  instanceOptions,
  statusOptions,
  minBillDate,
  maxBillDate,
  canReconcile,
  onChange,
  onApply,
  onReset,
  onRun,
  onOpenImport,
  onExport,
  exporting,
  exportDisabled,
  appliedChips,
}: {
  values: ReconciliationFilterValues;
  providerOptions: Array<{ value: string; label: string }>;
  instanceOptions: Array<{ value: string; label: string }>;
  statusOptions: Array<{ value: string; label: string }>;
  minBillDate: string;
  maxBillDate: string;
  canReconcile: boolean;
  onChange: (key: ReconciliationFilterKey, value: string | undefined) => void;
  onApply: () => void;
  onReset: () => void;
  onRun: () => void;
  onOpenImport: () => void;
  onExport: () => void;
  exporting: boolean;
  exportDisabled: boolean;
  appliedChips: AppliedFilter[];
}) {
  return (
    <FilterBar>
      <SelectField
        value={values.providerId}
        onChange={(value) => onChange('providerId', value)}
        options={providerOptions}
        allowClear
        clearLabel="全部渠道"
        className="w-[140px]"
        ariaLabel="对账渠道"
      />
      <SelectField
        value={values.providerInstanceId}
        onChange={(value) => onChange('providerInstanceId', value)}
        options={instanceOptions}
        allowClear
        clearLabel="选择实例"
        placeholder={values.providerId ? '选择实例' : '先选渠道'}
        className="w-[170px]"
        ariaLabel="对账服务商实例"
        disabled={!values.providerId}
      />
      <SelectField
        value={values.status}
        onChange={(value) => onChange('status', value)}
        options={statusOptions}
        allowClear
        clearLabel="全部状态"
        className="w-[120px]"
        ariaLabel="对账状态"
      />
      <DateField
        value={values.billDate}
        onChange={(value) => onChange('billDate', value)}
        ariaLabel="账单日期"
        minDate={minBillDate}
        maxDate={maxBillDate}
        className="w-[150px]"
      />
      <FilterActions>
        <ActionButton
          onClick={onRun}
          disabled={
            !canReconcile ||
            !values.providerId ||
            !values.providerInstanceId ||
            !values.billDate
          }
        >
          执行对账
        </ActionButton>
        <ActionButton
          variant="outline"
          onClick={onOpenImport}
          disabled={
            !canReconcile ||
            providerOptions.length === 0 ||
            !values.providerId ||
            !values.providerInstanceId
          }
        >
          导入 CSV
        </ActionButton>
        <ActionButton variant="secondary" onClick={onApply}>
          查询
        </ActionButton>
        <ActionButton variant="ghost" onClick={onReset}>
          重置
        </ActionButton>
        <ExportCsvButton onExport={onExport} exporting={exporting} disabled={exportDisabled} />
      </FilterActions>
      <AppliedFilters items={appliedChips} />
    </FilterBar>
  );
}
