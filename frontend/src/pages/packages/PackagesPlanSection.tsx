import { Check } from 'lucide-react';

import type { MembershipPlan, MyMembership } from '../../types/api';
import {
  BADGE_FREE,
  BADGE_HOT,
  CARD,
  CARD_BADGE,
  CARD_CURRENT,
  CARD_DESC,
  CARD_HOVER,
  CARD_NAME,
  CARD_POINTS,
  CARD_POINTS_VALUE,
  CARD_PRICE,
  CARD_PRICE_UNIT,
  CARD_PRICE_VALUE,
  CARD_TOP,
  SECTION,
  SECTION_COPY,
  SECTION_DESC,
  SECTION_HEAD,
  SECTION_TITLE,
} from './constants';
import { PLAN_VISUALS, formatDate, formatNumber, formatYuan, planActionLabel } from './utils';
import { Button } from './components';

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

/** 会员档：固定 240px 横排，一行放不下就横向滚动，不折行 */
const PLAN_CARD =
  `${CARD} ${CARD_HOVER} flex-[0_0_240px] min-w-[240px] max-w-[240px] snap-start ` +
  'max-[640px]:flex-[0_0_240px] max-[640px]:min-w-[240px] max-[640px]:max-w-[240px] ' +
  'max-[640px]:gap-3 max-[640px]:px-4 max-[640px]:pt-[18px] max-[640px]:pb-4';

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
    <section className={SECTION}>
      <div className={SECTION_HEAD}>
        <div className={SECTION_COPY}>
          <h2 className={SECTION_TITLE}>会员套餐</h2>
          <p className={SECTION_DESC}>订阅后每月自动发放积分，享专属权益</p>
        </div>
        {membership?.isMember && (
          <span className="shrink-0 rounded-full bg-brand-bg px-2.5 py-[3px] text-xs leading-[18px] text-brand">
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
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-dashed border-border bg-card px-[18px] py-3">
          <span className="text-sm leading-5 font-bold text-foreground">{freePlan.name}</span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs leading-4 font-semibold whitespace-nowrap ${BADGE_FREE}`}
          >
            永久免费
          </span>
          <span className="text-xs leading-[18px] text-[color:var(--text-muted)]">
            {freePlan.description}
          </span>
        </div>
      )}
      <div className="-mt-3 flex snap-x snap-proximity flex-nowrap justify-start gap-4 overflow-x-auto px-0.5 pt-3 pb-3 [scrollbar-width:thin] max-[640px]:gap-3">
        {paidPlans.map((plan, index) => {
          const isCurrent = currentPlanCode === plan.code;
          // 视觉标签按付费档顺序取; 后台新加的档位没有标签时回落有效期
          const visual = PLAN_VISUALS[index];
          // 当前方案描边 + 外环; 仅推荐档只换描边, 两者同时命中时当前方案优先
          const highlight = isCurrent
            ? CARD_CURRENT
            : visual?.recommended
              ? 'border-brand'
              : '';
          return (
            <article
              key={plan.id}
              className={`${PLAN_CARD}${highlight ? ` ${highlight}` : ''}`}
            >
              {isCurrent && (
                <span className="absolute -top-2.5 right-4 rounded-full bg-brand px-2.5 py-0.5 text-xs leading-4 font-semibold text-primary-foreground shadow-[0_4px_10px_rgba(85,70,216,0.25)]">
                  当前方案
                </span>
              )}
              <div className={CARD_TOP}>
                <span className={CARD_NAME}>{plan.name}</span>
                <span className={`${CARD_BADGE}${visual?.recommended ? ` ${BADGE_HOT}` : ''}`}>
                  {visual?.tag ?? `${plan.durationDays} 天有效`}
                </span>
              </div>
              <div className={CARD_POINTS}>
                <strong className={CARD_POINTS_VALUE}>{formatNumber(plan.monthlyCredits)}</strong>
                <span className="text-xs text-[color:var(--text-muted)]">积分 / 月</span>
              </div>
              <p className={CARD_DESC}>
                {plan.description ||
                  `订阅 ${plan.durationDays} 天，每月发放 ${plan.monthlyCredits} 积分`}
              </p>
              {plan.perkLabels.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {plan.perkLabels.map((label) => (
                    <li
                      key={label}
                      className="flex items-start gap-1.5 text-xs leading-[18px] text-[color:var(--text-body)]"
                    >
                      <Check size={13} className="mt-0.5 shrink-0 text-brand" aria-hidden />
                      {label}
                    </li>
                  ))}
                </ul>
              )}
              <div className={CARD_PRICE}>
                <strong className={CARD_PRICE_VALUE}>{formatYuan(plan.priceCents)}</strong>
                <span className={CARD_PRICE_UNIT}>/ {plan.durationDays} 天</span>
              </div>
              <Button className="h-auto w-full py-2.5 text-[13px] font-semibold" onClick={() => onSubscribe(plan)}>
                {planActionLabel(plan, currentPlanCode, currentPlan)}
              </Button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
