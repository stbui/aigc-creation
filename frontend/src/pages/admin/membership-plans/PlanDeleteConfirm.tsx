import { ConfirmDialog } from '~/admin-ui/primitives';
import { centsToYuan } from './utils';
import type { AdminMembershipPlan } from '../../../types/api';

interface PlanDeleteConfirmProps {
  target: AdminMembershipPlan | null;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 删除确认：仅无会员、无订单的自建套餐可以物理删除。 */
export function PlanDeleteConfirm({
  target,
  saving,
  onCancel,
  onConfirm,
}: PlanDeleteConfirmProps) {
  if (!target) return null;

  return (
    <ConfirmDialog
      open
      title={`删除会员套餐「${target.name}」`}
      confirmText="删除套餐"
      description="该套餐没有存量会员与订单，删除后将从后台列表移除，且无法恢复。"
      impact={[
        `套餐：${target.name}（${target.code}）`,
        `订阅价：¥ ${centsToYuan(target.priceCents)} / ${target.durationDays || '永久'} 天`,
        `存量会员：${target.memberCount} 人；历史订单：${target.orderCount} 笔`,
      ]}
      danger
      loading={saving}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
