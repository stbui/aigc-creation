import {
  ActionButton,
  AppliedFilters,
  FilterActions,
  FilterBar,
  Panel,
  SelectField,
  type AppliedFilter,
  type SelectFieldOption,
} from '~/admin-ui/primitives';

export function PaymentsExceptionFilterPanel({
  status,
  providerId,
  priority,
  overdue,
  statusOptions,
  providerOptions,
  priorityOptions,
  appliedFilters,
  onStatusChange,
  onProviderChange,
  onPriorityChange,
  onOverdueChange,
  onApply,
  onReset,
}: {
  status?: string;
  providerId?: string;
  priority?: string;
  overdue?: string;
  statusOptions: SelectFieldOption[];
  providerOptions: SelectFieldOption[];
  priorityOptions: SelectFieldOption[];
  appliedFilters: AppliedFilter[];
  onStatusChange: (value: string | undefined) => void;
  onProviderChange: (value: string | undefined) => void;
  onPriorityChange: (value: string | undefined) => void;
  onOverdueChange: (value: string | undefined) => void;
  onApply: () => void;
  onReset: () => void;
}) {
  return (
    <>
      <Panel title="异常筛选" note="SLA 2 小时；逾期单会优先展示">
        <FilterBar>
          <SelectField
            value={status}
            onChange={onStatusChange}
            options={statusOptions}
            allowClear
            className="w-[140px]"
            ariaLabel="筛选异常状态"
          />
          <SelectField
            value={providerId}
            onChange={onProviderChange}
            options={providerOptions}
            allowClear
            className="w-[130px]"
            ariaLabel="筛选异常渠道"
          />
          <SelectField
            value={priority}
            onChange={onPriorityChange}
            options={priorityOptions}
            allowClear
            className="w-[120px]"
            ariaLabel="筛选异常优先级"
          />
          <SelectField
            value={overdue}
            onChange={onOverdueChange}
            options={[
              { value: 'true', label: '仅看逾期' },
              { value: 'false', label: '全部 SLA' },
            ]}
            allowClear
            className="w-[120px]"
            ariaLabel="筛选 SLA"
          />
          <FilterActions>
            <ActionButton onClick={onApply}>查询</ActionButton>
            <ActionButton variant="ghost" onClick={onReset}>
              重置
            </ActionButton>
          </FilterActions>
        </FilterBar>
      </Panel>

      {appliedFilters.length > 0 && <AppliedFilters items={appliedFilters} />}
    </>
  );
}
