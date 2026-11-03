import { useMemo } from 'react';
import { StatCard } from '~/admin-ui/primitives';
import type { AdminMembershipPlan } from '../../../types/api';

/** 会员套餐统计条：套餐总数 / 在售 / 付费 / 存量会员 */
export function PlanStats({ rows }: { rows: AdminMembershipPlan[] }) {
  const stats = useMemo(() => {
    const active = rows.filter((p) => p.status === 'active');
    const members = rows.reduce((sum, p) => sum + p.memberCount, 0);
    const paid = rows.filter((p) => p.priceCents > 0);
    return { active: active.length, members, paid: paid.length };
  }, [rows]);

  return (
    <div className="mb-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
      <StatCard label="套餐总数" value={rows.length} hint="含 free 与已下架套餐" />
      <StatCard label="在售" value={stats.active} hint="C 端价目表可见并可下单" />
      <StatCard label="付费套餐" value={stats.paid} hint="订阅价大于 0 的套餐" />
      <StatCard label="存量会员" value={stats.members} hint="按当前套餐订阅的用户数（含历史）" />
    </div>
  );
}
