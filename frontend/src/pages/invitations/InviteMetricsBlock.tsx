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
    <section className="invite-block">
      <div className="invite-block-head">
        <h2>
          <Users size={16} aria-hidden /> 数据明细
        </h2>
        <span className="invite-block-sub">只统计已产生的邀请关系</span>
      </div>
      <div className="invite-metrics">
        {rows.map((row) => (
          <div key={row.label} className="invite-metric">
            <span className="invite-metric-label">
              <row.Icon size={13} aria-hidden /> {row.label}
            </span>
            <span className={`invite-metric-value${row.highlight ? ' is-brand' : ''}`}>
              {formatNumber(row.value)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
