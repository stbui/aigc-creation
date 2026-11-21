import { ScrollText } from 'lucide-react';

import type { MyInvites } from './constants';

interface InviteRulesBlockProps {
  rule: MyInvites['rule'];
  enabled: boolean;
  metrics: MyInvites['metrics'];
}

/** 规则说明：奖励口径、绑定限制与待发放预估。 */
export function InviteRulesBlock({ rule, enabled, metrics }: InviteRulesBlockProps) {
  return (
    <section className="rounded-xl border border-border bg-card px-6 pt-[22px] pb-6 max-[640px]:px-4 max-[640px]:pt-[18px] max-[640px]:pb-5">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="m-0 flex items-center gap-2 text-base font-semibold text-foreground">
          <ScrollText size={16} aria-hidden /> 规则说明
        </h2>
      </div>
      <ul className="m-0 flex list-disc flex-col gap-2 pl-[18px] text-[13px] leading-[22px] text-muted-foreground">
        <li>
          被邀请人奖励 {rule.inviteeCredits} 积分，
          {rule.inviterCredits > 0 ? `邀请人奖励 ${rule.inviterCredits} 积分` : '当前不设邀请人奖励'}
          ；触发时机为{rule.triggerOn === 'first_pay' ? '被邀请人首次付费' : '被邀请人注册'}。
        </li>
        <li>一个账号只能被一位邀请人绑定；自邀请不生效。</li>
        {/* 待发放为 0 时这条没有信息量, 不占一行 */}
        {metrics.pendingCount > 0 && (
          <li>
            累计收益只统计已发放的邀请。待发放的 {metrics.pendingCount} 笔按当前规则预估约{' '}
            {metrics.pendingCredits} 积分，规则调整后以实际发放为准。
          </li>
        )}
        {!rule.valid && <li>邀请奖励当前已关闭，新绑定不发放积分。</li>}
        {enabled && <li>奖励以积分形式发放，可在积分明细中查看到账流水。</li>}
      </ul>
    </section>
  );
}
