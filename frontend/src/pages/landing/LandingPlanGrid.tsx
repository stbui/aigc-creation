import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import type { MembershipPlan } from '../../types/api';
import type { LandingCatalogState } from './hooks';
import { PLAN_VISUALS, formatNumber } from './utils';
import { Badge, Button, Surface, SurfaceContent } from './components';

interface LandingPlanGridProps {
  plans: MembershipPlan[];
  state: LandingCatalogState;
}

/**
 * 订阅套餐卡：价格、积分与权益全部来自后端，不回落硬编码价目。
 *
 * 卡片壳 `Surface`，推荐角标 `Badge`（品牌实底），底部购买是 `Button asChild`
 * 指向结算页 —— 订阅购买走订单 + 支付链路，链接语义不变。
 */
export function LandingPlanGrid({ plans, state }: LandingPlanGridProps) {
  const payablePlans = plans.filter((plan) => plan.durationDays > 0);

  return (
    <div className="grid grid-cols-3 gap-4.5 max-[1080px]:grid-cols-2 max-[640px]:grid-cols-1">
      {state === 'loading' && <LandingCatalogEmpty>套餐加载中…</LandingCatalogEmpty>}
      {state === 'error' && (
        <LandingCatalogEmpty>套餐暂时加载失败，请稍后刷新查看</LandingCatalogEmpty>
      )}
      {state === 'ready' && payablePlans.length === 0 && (
        <LandingCatalogEmpty>暂无可用套餐</LandingCatalogEmpty>
      )}
      {payablePlans.map((plan, index) => {
        const visual = PLAN_VISUALS[index];
        const recommended = visual?.recommended ?? false;
        return (
          <Surface
            key={plan.id}
            className={[
              'relative gap-0 rounded-xl border py-0 transition-[border-color,box-shadow,transform] duration-200',
              'hover:-translate-y-0.5 hover:border-brand hover:shadow-card',
              recommended
                ? 'border-brand shadow-[0_14px_34px_color-mix(in_srgb,var(--brand)_14%,transparent)]'
                : 'border-border',
            ].join(' ')}
          >
            {visual?.tag && (
              <Badge
                variant={recommended ? 'default' : 'secondary'}
                className={[
                  'absolute top-3.5 right-3.5 h-auto rounded-full px-2.5 py-0.75 text-xs font-semibold',
                  recommended ? '' : 'bg-brand-bg text-brand',
                ].join(' ')}
              >
                {visual.tag}
              </Badge>
            )}

            <SurfaceContent className="flex flex-1 flex-col px-[22px] pt-6 pb-5">
              <h3 className="m-0 pr-16 text-base font-semibold text-foreground">{plan.name}</h3>

              <div className="mt-3.5 flex items-baseline gap-0.75 text-foreground">
                <span className="text-base font-bold">¥</span>
                <strong className="text-[32px] font-bold tracking-[-0.5px]">
                  {(plan.priceCents / 100).toFixed(2)}
                </strong>
                <em className="text-[12.5px] font-normal text-muted-foreground not-italic">
                  / {plan.durationDays} 天
                </em>
              </div>

              <p className="mt-2 text-[13.5px] font-semibold text-brand">
                {formatNumber(plan.monthlyCredits)} 积分 / 月
              </p>

              {/* 权益文案由后端 buildPerkLabels 生成 —— 改权益只需改一处,
                  不会出现「宣传页写的和实际给的不一样」 */}
              <ul className="mt-4 mb-5 flex list-none flex-col gap-2.25 p-0">
                {plan.perkLabels.map((perk) => (
                  <li
                    key={perk}
                    className="flex items-start gap-1.75 text-[13px] leading-[1.5] text-muted-foreground"
                  >
                    <Check size={13} aria-hidden className="mt-0.5 shrink-0 text-brand" />
                    {perk}
                  </li>
                ))}
              </ul>

              {/*
               * 订阅购买走订单 + 支付链路: MembershipPlan 不在 Product 表里,
               * 下单时走 `membershipPlanId`, 与积分包同一条支付通道。
               */}
              <Button
                asChild
                className="mt-auto h-10 w-full rounded-md text-sm font-semibold hover:bg-brand-hover"
              >
                <Link to={`/checkout/membership?planId=${encodeURIComponent(plan.id)}`}>
                  立即订阅
                </Link>
              </Button>
            </SurfaceContent>
          </Surface>
        );
      })}
    </div>
  );
}

/** 价目区的加载 / 失败 / 空态：整行占满，说明文案如实，不回落价目 */
export function LandingCatalogEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="col-span-full m-0 px-3 py-9 text-center text-[13px] text-muted-foreground">
      {children}
    </p>
  );
}
