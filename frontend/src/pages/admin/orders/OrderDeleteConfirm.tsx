import { ConfirmDialog } from '~/admin-ui/primitives';
import { yuan } from './utils';
import type { AdminOrderRow } from '../../../types/api';

/** 删除确认：仅允许从未产生业务记录的待支付/已取消订单。 */
export function OrderDeleteConfirm({
  target,
  loading,
  onCancel,
  onConfirm,
}: {
  target: AdminOrderRow | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!target) return null;

  return (
    <ConfirmDialog
      open
      title={`删除订单 ${target.orderNo}`}
      confirmText="删除订单"
      description="仅可删除未支付且没有任何支付、退款、积分、会员、发票、对账或工单关联的订单。删除后无法恢复。"
      impact={[
        `用户：${target.userEmail}`,
        `金额：¥ ${yuan(target.totalCents)}`,
        `状态：${target.status === 'pending' ? '待支付' : '已取消'}`,
        `商品：${target.items.map((item) => item.name).join('、') || `${target.itemCount} 件商品`}`,
        '删除时会再次校验关联记录；已有业务记录的订单会被拒绝',
      ]}
      danger
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
