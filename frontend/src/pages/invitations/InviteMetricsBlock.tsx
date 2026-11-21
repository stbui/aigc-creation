import { BadgeCheck, Clock3, Coins, Users } from 'lucide-react';

import type { MyInvites } from './constants';
import { formatNumber } from './utils';

interface InviteMetricsBlockProps {
  metrics: MyInvites['metrics'];
}

/** 数据明细：四项指标都来自真实关系表，没有占位数字。 */
export function InviteMetricsBlock({ metrics }: InviteMetricsBlockProps) {
  const rows = [
    { label: '累计邀请（人）', value: metrics.totalInvited, Icon: Users, highlight: false },
    { label: '累计收益（积分）', value: metrics.earnedCredits, Icon: Coins, highlight: true },
    { label: '已发放（笔）', value: metrics.rewardedCount, Icon: BadgeCheck, highlight: false },
    { label: '待发放（笔）', value: metrics.pendingCount, Icon: Clock3, highlight: false },
  ];

  return (
    <section className="rounded-xl border border-border bg-card px-6 pt-[22px] pb-6 max-[640px]:px-4 max-[640px]:pt-[18px] max-[640px]:pb-5">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="m-0 flex items-center gap-2 text-base font-semibold text-foreground">
          <Users size={16} aria-hidden /> 数据明细
        </h2>
        <span className="text-xs leading-[18px] text-muted-foreground">只统计已产生的邀请关系</span>
      </div>
      <div className="grid grid-cols-2 gap-4 min-[901px]:grid-cols-4">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-1.5 rounded-lg bg-page p-4">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <row.Icon size={13} aria-hidden /> {row.label}
            </span>
            <span
              className={`text-2xl font-bold ${row.highlight ? 'text-brand' : 'text-foreground'}`}
            >
              {formatNumber(row.value)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
