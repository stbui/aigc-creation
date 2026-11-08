import { ActionButton, DateField, FormField, Panel, SelectField } from '~/admin-ui/primitives';

/** 手动执行对账与兜底导入入口。 */
export function ReconciliationRunPanel({
  providerOptions,
  providerId,
  billDate,
  minBillDate,
  maxBillDate,
  canReconcile,
  onProviderChange,
  onBillDateChange,
  onRun,
  onOpenImport,
}: {
  providerOptions: Array<{ value: string; label: string }>;
  providerId: string;
  billDate: string;
  minBillDate: string;
  maxBillDate: string;
  canReconcile: boolean;
  onProviderChange: (value: string) => void;
  onBillDateChange: (value: string) => void;
  onRun: () => void;
  onOpenImport: () => void;
}) {
  return (
    <Panel
      title="执行对账"
      note="系统每天 10:15 后自动对账昨日账单；失败可在同一账单日重跑"
    >
      <div className="flex flex-wrap items-end gap-3 px-4 py-3">
        <FormField label="渠道" className="w-[160px]">
          <SelectField
            value={providerId || undefined}
            onChange={(value) => onProviderChange(value ?? '')}
            options={providerOptions}
            placeholder="选择渠道"
            ariaLabel="对账渠道"
          />
        </FormField>
        <FormField label="账单日期" className="w-[180px]" hint="最早 90 天前，最晚昨天">
          <DateField
            value={billDate}
            onChange={onBillDateChange}
            ariaLabel="账单日期"
            minDate={minBillDate}
            maxDate={maxBillDate}
          />
        </FormField>
        <ActionButton onClick={onRun} disabled={!canReconcile || !providerId}>
          执行对账
        </ActionButton>
        <ActionButton
          onClick={onOpenImport}
          disabled={!canReconcile || providerOptions.length === 0}
        >
          导入 CSV
        </ActionButton>
      </div>
    </Panel>
  );
}
