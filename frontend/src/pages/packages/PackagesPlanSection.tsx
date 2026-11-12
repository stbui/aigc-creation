import { Check } from 'lucide-react';

import type { MembershipPlan, MyMembership } from '../../types/api';
import { PLAN_VISUALS, formatDate, formatNumber, formatYuan, planActionLabel } from './utils';

interface PackagesPlanSectionProps {
  /** 付费档：视觉标签按付费档顺序取 */
  paidPlans: MembershipPlan[];
  /** 免费档：单独压成一行基线说明，不参与套餐卡排列 */
  freePlan: MembershipPlan | null;
  membership: MyMembership | null;
  currentPlanCode: string | null;
  currentPlan: MembershipPlan | null;
  onSubscribe: (plan: MembershipPlan) => void;
}

/** 会员套餐：免费档说明 + 付费档卡片。 */
export function PackagesPlanSection({
  paidPlans,
  freePlan,
  membership,
  currentPlanCode,
  currentPlan,
  onSubscribe,
}: PackagesPlanSectionProps) {
  return (
    <section className="pkg-section">
      <div className="pkg-section-head">
        <div className="pkg-section-copy">
          <h2>会员套餐</h2>
          <p>订阅后每月自动发放积分，享专属权益</p>
        </div>
        {membership?.isMember && (
          <span className="pkg-section-note">
            当前：{membership.planName}
            {membership.expiresAt ? ` · ${formatDate(membership.expiresAt, '')} 到期` : ''}
          </span>
        )}
      </div>
      {/*
       * 免费档不作为商品陈列: 它没有价格、没有月度配额、也没有可点的按钮,
       * 混在付费卡里只会撑出一张空心卡并打乱行数。压成一行基线说明,
       * 付费档就能整齐排成 3×2。
       */}
      {freePlan && (
        <div className="pkg-free-strip">
          <span className="pkg-free-strip-name">{freePlan.name}</span>
          <span className="pkg-card-badge is-free">永久免费</span>
          <span className="pkg-free-strip-desc">{freePlan.description}</span>
        </div>
      )}
      <div className="pkg-grid is-plans">
        {paidPlans.map((plan, index) => {
          const isCurrent = currentPlanCode === plan.code;
          // 视觉标签按付费档顺序取; 后台新加的档位没有标签时回落有效期
          const visual = PLAN_VISUALS[index];
          return (
            <article
              key={plan.id}
              className={`pkg-card${isCurrent ? ' is-current' : visual?.recommended ? ' is-recommended' : ''}`}
            >
              {isCurrent && <span className="pkg-card-flag">当前方案</span>}
              <div className="pkg-card-top">
                <span className="pkg-card-name">{plan.name}</span>
                <span className={`pkg-card-badge${visual?.recommended ? ' is-hot' : ''}`}>
                  {visual?.tag ?? `${plan.durationDays} 天有效`}
                </span>
              </div>
              <div className="pkg-card-points">
                <strong>{formatNumber(plan.monthlyCredits)}</strong>
                <span>积分 / 月</span>
              </div>
              <p className="pkg-card-desc">
                {plan.description ||
                  `订阅 ${plan.durationDays} 天，每月发放 ${plan.monthlyCredits} 积分`}
              </p>
              {plan.perkLabels.length > 0 && (
                <ul className="pkg-card-perks">
                  {plan.perkLabels.map((label) => (
                    <li key={label}>
                      <Check size={13} aria-hidden />
                      {label}
                    </li>
                  ))}
                </ul>
              )}
              <div className="pkg-card-price">
                <strong>{formatYuan(plan.priceCents)}</strong>
                <span className="pkg-card-price-unit">/ {plan.durationDays} 天</span>
              </div>
              <button type="button" className="pkg-select-btn" onClick={() => onSubscribe(plan)}>
                {planActionLabel(plan, currentPlanCode, currentPlan)}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
