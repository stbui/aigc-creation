import { Check } from 'lucide-react';

import type { MembershipPlan, Product } from '../../types/api';

/**
 * 商品 / 套餐信息卡。
 *
 * 两种口径不能混: 积分包说「立刻到账 N 积分」，会员说「月度积分按月发放」——
 * 写成同一个「获得积分」会误导。会员权益来自套餐本身的可读文案，空数组时整块不渲染。
 *
 * 页面已经保证 `plan` 与 `product` 至少有一个; 两者都为空时不会走到这里。
 */
export function CheckoutOrderCard({
  product,
  plan,
}: {
  product: Product | null;
  plan: MembershipPlan | null;
}) {
  return (
    <>
      <section className="co-card">
        <div className="co-card-head">
          <h2>{plan ? '套餐信息' : '商品信息'}</h2>
          <span>数量 1</span>
        </div>
        <dl className="co-rows">
          <div className="co-row">
            <dt>{plan ? '套餐' : '商品'}</dt>
            <dd>{plan ? plan.name : product!.name}</dd>
          </div>
          {/*
            会员单展示的是「权益口径」而非积分: 月度积分按月发放, 与一次性
            积分包的「立刻到账 N 积分」不是同一件事, 写成「获得积分」会误导。
          */}
          {plan ? (
            <>
              <div className="co-row">
                <dt>会员周期</dt>
                <dd>{plan.durationDays} 天</dd>
              </div>
              <div className="co-row">
                <dt>月度积分</dt>
                <dd>{plan.monthlyCredits} 积分 / 月</dd>
              </div>
            </>
          ) : (
            <>
              <div className="co-row">
                <dt>获得积分</dt>
                <dd>{product!.credits} 积分</dd>
              </div>
              <div className="co-row">
                <dt>积分有效期</dt>
                <dd>{product!.creditsValidDays > 0 ? `${product!.creditsValidDays} 天` : '永久有效'}</dd>
              </div>
            </>
          )}
        </dl>
      </section>

      {/* 权益来自套餐本身 (后端生成的可读文案), 空数组时整块不渲染 */}
      {plan && plan.perkLabels.length > 0 && (
        <section className="co-card">
          <div className="co-card-head">
            <h2>会员权益</h2>
            <span>订阅期内有效</span>
          </div>
          <ul className="co-perks">
            {plan.perkLabels.map((label) => (
              <li key={label}>
                <Check size={14} aria-hidden />
                {label}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
