import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';

import type { MembershipPlan } from '../../types/api';
import type { LandingCatalogState } from './hooks';
import { PLAN_VISUALS } from './utils';

interface LandingPlanGridProps {
  plans: MembershipPlan[];
  state: LandingCatalogState;
}

/** 订阅套餐卡：价格、积分与权益全部来自后端，不回落硬编码价目。 */
export function LandingPlanGrid({ plans, state }: LandingPlanGridProps) {
  const navigate = useNavigate();
  const payablePlans = plans.filter((plan) => plan.durationDays > 0);

  return (
    <div className="lp-plan-grid">
      {state === 'loading' && <p className="lp-empty">套餐加载中…</p>}
      {state === 'error' && <p className="lp-empty">套餐暂时加载失败，请稍后刷新查看</p>}
      {state === 'ready' && payablePlans.length === 0 && <p className="lp-empty">暂无可用套餐</p>}
      {payablePlans.map((plan, index) => {
        const visual = PLAN_VISUALS[index];
        return (
          <article
            key={plan.id}
            className={`lp-plan-card${visual?.recommended ? ' is-recommended' : ''}`}
          >
            {visual?.tag && (
              <span className={`lp-plan-tag${visual.recommended ? ' is-hot' : ''}`}>
                {visual.tag}
              </span>
            )}
            <h3>{plan.name}</h3>
            <div className="lp-plan-price">
              <span className="cur">¥</span>
              <strong>{(plan.priceCents / 100).toFixed(2)}</strong>
              <em>/ {plan.durationDays} 天</em>
            </div>
            <p className="lp-plan-credits">
              {plan.monthlyCredits.toLocaleString('zh-CN')} 积分 / 月
            </p>
            {/* 权益文案由后端 buildPerkLabels 生成 —— 改权益只需改一处,
                不会出现「宣传页写的和实际给的不一样」 */}
            <ul className="lp-plan-perks">
              {plan.perkLabels.map((perk) => (
                <li key={perk}>
                  <Check size={13} aria-hidden />
                  {perk}
                </li>
              ))}
            </ul>
            {/*
             * 订阅购买走订单+支付链路: MembershipPlan 不在 Product 表里,
             * 下单时走 `membershipPlanId`, 与积分包同一条支付通道。
             */}
            <button
              type="button"
              className="lp-plan-buy"
              onClick={() => navigate(`/checkout/membership?planId=${encodeURIComponent(plan.id)}`)}
            >
              立即订阅
            </button>
          </article>
        );
      })}
    </div>
  );
}
