import { ConfirmAction } from './components';
import { centsToYuan } from './utils';
import type { AdminMembershipPlan } from '../../../types/api';

interface PlanStatusConfirmProps {
  target: AdminMembershipPlan | null;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 上下架确认：下架不影响存量会员。 */
export function PlanStatusConfirm({
  target,
  saving,
  onCancel,
  onConfirm,
}: PlanStatusConfirmProps) {
  if (!target) return null;

  return (
    <ConfirmAction
      open
      title={target.status === 'active' ? '下架会员套餐' : '上架会员套餐'}
      confirmText={target.status === 'active' ? '确认下架' : '确认上架'}
      loading={saving}
      description={
        <p>
          {target.status === 'active'
            ? '下架后 C 端不再展示该套餐，但存量会员已付周期的权益不受影响。'
            : '上架后该套餐会出现在 C 端价目表并允许下单。'}
        </p>
      }
      impact={[
        `套餐：${target.name}（${target.code}）`,
        `订阅价：¥ ${centsToYuan(target.priceCents)} / ${target.durationDays || '永久'} 天`,
        `当前存量会员：${target.memberCount} 人`,
      ]}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
