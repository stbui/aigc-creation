import { StatCard } from './components';
import type { TicketStats } from '../../../types/api';

/**
 * 工单概览统计卡。
 *
 * 统计未取到时显示「—」而不是 0 —— 0 会被读成「今天没有工单」。
 */
export function TicketStatsCards({ stats }: { stats: TicketStats | null }) {
  return (
    <div className="mb-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
      <StatCard
        label="待处理"
        value={stats?.pending ?? '—'}
        hint="未受理 + 处理中的总量"
        tone={(stats?.pending ?? 0) > 0 ? 'warn' : undefined}
      />
      <StatCard label="待受理" value={stats?.open ?? '—'} hint="尚无人认领" />
      <StatCard label="处理中" value={stats?.processing ?? '—'} hint="已受理，等待结论" />
      <StatCard label="已解决" value={stats?.resolved ?? '—'} hint="等待用户确认或关闭" />
      <StatCard label="已关闭" value={stats?.closed ?? '—'} hint="会话结束" />
    </div>
  );
}
