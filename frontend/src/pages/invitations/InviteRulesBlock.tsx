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
    <section className="invite-block">
      <div className="invite-block-head">
        <h2>
          <ScrollText size={16} aria-hidden /> 规则说明
        </h2>
      </div>
      <ul className="invite-rules">
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
