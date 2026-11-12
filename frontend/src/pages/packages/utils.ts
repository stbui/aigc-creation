/**
 * 积分商城页面的纯函数与外部工具入口 —— 目录内文件的唯一本页工具来源。
 */

import type { MembershipPlan, Product } from '../../types/api';

/** 金额 / 数字 / 日期格式化（整数分由后端下发，这里只做展示层换算） */
export { formatDate, formatNumber, formatYuan } from '../../lib/format';
/** 套餐卡视觉装饰（推荐标签等），与定价无关 */
export { PLAN_VISUALS } from '../../lib/constants';

/**
 * 折合单价 (元 / 积分)，只对「付费且积分 > 0」的商品有意义。
 *
 * 购包时用户真正比较的是单价而不是总价 —— 总价随档位单调上升，
 * 只给总价等于让人自己做除法。保留 4 位小数：积分单价普遍在 0.01–0.03 元。
 */
export function formatPerCredit(product: Product): string | null {
  if (product.priceCents <= 0 || product.credits <= 0) return null;
  return `¥${(product.priceCents / product.credits / 100).toFixed(4)}`;
}

/**
 * 找出「每元积分最多」的在售商品, 用于卡片上的「最划算」标记。
 *
 * 只比较付费商品, 且至少两件时才标记 —— 只有一件付费包时人人都是最划算,
 * 等于没有信息。免费包不参与: 单价比不出高低, 标了反而误导。
 */
export function pickBestValueId(products: Product[]): string | null {
  const paid = products.filter((product) => product.priceCents > 0 && product.credits > 0);
  if (paid.length < 2) return null;
  return paid.reduce((best, product) =>
    product.credits / product.priceCents > best.credits / best.priceCents ? product : best,
  ).id;
}

/** 会员卡按钮文案: 免费档 / 首订 / 续费 / 升降级 */
export function planActionLabel(
  plan: MembershipPlan,
  currentPlanCode: string | null,
  currentPlan: MembershipPlan | null,
): string {
  if (plan.durationDays <= 0) {
    return currentPlanCode === plan.code ? '当前方案' : '免费档';
  }
  if (!currentPlanCode) return '订阅';
  if (currentPlanCode === plan.code) return '续费';
  if (currentPlan && plan.priceCents < currentPlan.priceCents) return '切换';
  return '升级';
}
