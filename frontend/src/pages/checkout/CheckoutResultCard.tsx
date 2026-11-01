import { CheckCircle2, Clock, XCircle } from 'lucide-react';

import type { MembershipPlan } from '../../types/api';
import type { ResultView } from './constants';
import { formatYuan } from './utils';

/**
 * 支付结果视图。
 *
 * 失败 / 超时都把后端给的 message 原样透出，不粉饰成「稍后再试」——
 * 结果如实展示是这个页面的硬约束。金额与积分以订单快照为准。
 */
export function CheckoutResultCard({
  result,
  plan,
  onNavigate,
}: {
  result: ResultView;
  plan: MembershipPlan | null;
  onNavigate: (to: string) => void;
}) {
  const Icon = result.kind === 'success' ? CheckCircle2 : result.kind === 'timeout' ? Clock : XCircle;

  return (
    <div className="pkg-checkout-page">
      <div className="co-shell">
        <div className="co-result">
          <div className={`co-result-icon is-${result.kind}`}>
            <Icon size={26} aria-hidden />
          </div>
          <h1 className="co-result-title">{result.title}</h1>
          <p className="co-result-desc">{result.desc}</p>

          <dl className="co-result-rows">
            <div className="co-result-row">
              <dt>订单号</dt>
              <dd>{result.order.orderNo}</dd>
            </div>
            <div className="co-result-row">
              <dt>实付金额</dt>
              <dd>{formatYuan(result.order.paidCents)}</dd>
            </div>
            {result.order.grantedCredits > 0 && (
              <div className="co-result-row">
                <dt>获得积分</dt>
                <dd>{result.order.grantedCredits}</dd>
              </div>
            )}
            {result.balance && (
              <div className="co-result-row">
                <dt>当前余额</dt>
                <dd>{result.balance.balance}</dd>
              </div>
            )}
            {result.balance && result.balance.expiringSoon > 0 && (
              <div className="co-result-row">
                <dt>30 天内到期</dt>
                <dd>{result.balance.expiringSoon}</dd>
              </div>
            )}
            {result.order.discountCents > 0 && (
              <div className="co-result-row">
                <dt>优惠减免</dt>
                <dd>-{formatYuan(result.order.discountCents)}</dd>
              </div>
            )}
          </dl>

          <div className="co-result-actions">
            <button type="button" className="co-btn" onClick={() => onNavigate('/orders')}>
              我的订单
            </button>
            <button
              type="button"
              className="co-btn is-primary"
              onClick={() => onNavigate(plan ? '/' : '/packages')}
            >
              {plan ? '返回首页' : '继续购买'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
