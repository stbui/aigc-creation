import { Check, Coins, Sparkles } from 'lucide-react';

import { formatYuan } from './utils';
import type { MembershipPlan, Product } from '../../types/api';

/**
 * 商品 / 套餐信息卡。
 *
 * 商品名与价格作为主视觉，规格拆成标签行 —— 原来的「标签 + 右对齐值」表格
 * 在窄屏会把中文压成竖排单字。两种口径不能混: 积分包说「立刻到账 N 积分」，
 * 会员说「月度积分按月发放」。会员权益来自套餐本身的可读文案，空数组时整块不渲染。
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
          <h2>
            <span className="co-step">1</span>
            {plan ? '套餐信息' : '商品信息'}
          </h2>
          <span>数量 1</span>
        </div>

        <div className="co-product">
          <span className="co-product-icon" aria-hidden>
            {plan ? <Sparkles size={22} /> : <Coins size={22} />}
          </span>
          <div className="co-product-body">
            <p className="co-product-name">{plan ? plan.name : product!.name}</p>
            {/* 会员是「月度发放」，积分包是「一次性即时到账」，不能共用一个说法 */}
            <p className="co-product-meta">
              {plan
                ? `${plan.durationDays} 天有效 · 每月 ${plan.monthlyCredits} 积分`
                : `支付完成后 ${product!.credits} 积分即时到账`}
            </p>
          </div>
          <strong className="co-product-price">
            {formatYuan(plan ? plan.priceCents : product!.priceCents)}
          </strong>
        </div>

        <ul className="co-product-tags">
          {plan ? (
            <>
              <li>会员周期 {plan.durationDays} 天</li>
              <li>每月 {plan.monthlyCredits} 积分</li>
            </>
          ) : (
            <>
              <li>获得 {product!.credits} 积分</li>
              <li>
                {product!.creditsValidDays > 0
                  ? `积分 ${product!.creditsValidDays} 天有效`
                  : '积分永久有效'}
              </li>
            </>
          )}
        </ul>
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
