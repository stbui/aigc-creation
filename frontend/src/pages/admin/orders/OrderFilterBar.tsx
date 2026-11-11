import {
  ActionButton,
  AppliedFilters,
  ClearableField,
  DateRangeField,
  FilterActions,
  FilterBar,
  SelectField,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import { CHANNEL_OPTIONS, REFUND_STATE_OPTIONS, STATUS_OPTIONS } from './constants';

export interface OrderFilterValues {
  status?: string;
  refundState?: string;
  orderNo: string;
  email: string;
  channel?: string;
  from: string;
  to: string;
}

export type OrderFilterKey = keyof OrderFilterValues;

/** 订单列表筛选条：只负责草稿值与交互，应用/重置由页面统一写查询参数。 */
export function OrderFilterBar({
  values,
  onChange,
  onApply,
  onReset,
  appliedChips,
}: {
  values: OrderFilterValues;
  onChange: (key: OrderFilterKey, value: string | undefined) => void;
  onApply: () => void;
  onReset: () => void;
  appliedChips: AppliedFilter[];
}) {
  return (
    <FilterBar>
      <SelectField
        className="w-32"
        ariaLabel="按状态筛选"
        clearLabel="全部状态"
        allowClear
        value={values.status}
        onChange={(value) => onChange('status', value)}
        options={STATUS_OPTIONS}
      />
      <ClearableField
        className="w-40"
        ariaLabel="按订单号搜索"
        placeholder="订单号"
        value={values.orderNo}
        onChange={(value) => onChange('orderNo', value)}
        onEnter={onApply}
      />
      {/*
       * 邮箱而非用户 ID: 客服拿到的是用户自报的邮箱。用 ID 意味着先查用户
       * 再查订单, 多一步且该用户未必记得自己的 id。
       */}
      <ClearableField
        className="w-44"
        ariaLabel="按用户邮箱搜索"
        placeholder="用户邮箱"
        value={values.email}
        onChange={(value) => onChange('email', value)}
        onEnter={onApply}
      />
      <SelectField
        className="w-32"
        ariaLabel="按渠道筛选"
        clearLabel="全部渠道"
        allowClear
        value={values.channel}
        onChange={(value) => onChange('channel', value)}
        options={CHANNEL_OPTIONS}
      />
      {/*
       * 退款状态是 Refund 维度，订单仍可能显示 paid —— 这正是渠道异步退款
       * 需要人工核对的场景。告警中心 `?refundState=processing` 直达这里。
       */}
      <SelectField
        className="w-32"
        ariaLabel="按退款状态筛选"
        clearLabel="全部退款"
        allowClear
        value={values.refundState}
        onChange={(value) => onChange('refundState', value)}
        options={REFUND_STATE_OPTIONS}
      />
      <DateRangeField
        className="w-60"
        from={values.from}
        to={values.to}
        onChange={({ from, to }) => {
          onChange('from', from);
          onChange('to', to);
        }}
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
