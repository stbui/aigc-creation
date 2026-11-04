/**
 * 结算页的纯函数 —— 目录内文件的唯一本页工具来源。
 *
 * 本页的外部依赖 (接口 / 组件 / hook) 分别走 `api.ts` / `components.ts` /
 * `hooks.ts`; 这里只放不依赖 React 的金额、幂等键、试算错误文案换算与
 * 「这张订单还能不能付」的判定。
 */

import type { Order, OrderStatus } from '../../types/api';

export { formatYuan } from '../../lib/money';

/** 幂等键。crypto.randomUUID 在非安全上下文 (http) 下可能缺失, 故留兜底 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * 券码试算失败时给用户的文案。
 *
 * 分两档: 4xx 是「这张券本身不可用」(把后端原因透出);
 * 其余按网络 / 服务异常处理，并明确仍然可以按原价结算。
 * `couponCode` 为空时返回 null —— 没填券就没有可提示的失败。
 */
export function quoteErrorMessageOf(error: unknown, couponCode: string): string | null {
  if (!couponCode.trim()) return null;
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: number }).status ?? 0)
      : 0;
  const message = error instanceof Error ? error.message : '';
  return status >= 400 && status < 500
    ? `优惠码不可用：${message || '券码不存在或已失效'}`
    : '优惠试算失败，当前按原价结算';
}

/* ── 订单可支付判定 ─────────────────────────────────────────────────────
 *
 * 页面（渲染「不能支付」提示）与支付状态机（真正发起支付前再拦一次）共用同一
 * 份判定，否则会出现「按钮放行了但接口 409」这类前端自己造出来的失败。
 * 2026-11-04 从 `page.tsx` 移入。
 */

const ORDER_STATUS_TEXT: Record<OrderStatus, string> = {
  pending: '待支付',
  paid: '已支付',
  cancelled: '已取消',
  refunded: '已退款',
  partial_refunded: '部分退款',
};

/** 只有待支付且未过期的订单才能继续发起支付 */
export function isOrderPayable(order: Order): boolean {
  return order.status === 'pending' && new Date(order.expiresAt).getTime() > Date.now();
}

/**
 * 不能支付的原因文案；可支付时返回 null。
 *
 * 分两种: 状态不对（已付 / 已取消 / 已退款）与超时。两者的用户动作不同 ——
 * 前者要回订单页，后者要重新下单，所以不合并成一句「订单不可用」。
 */
export function blockedReasonOf(order: Order): string | null {
  if (isOrderPayable(order)) return null;
  if (order.status !== 'pending') {
    return `该订单当前状态为「${ORDER_STATUS_TEXT[order.status] ?? order.status}」，不能继续支付。`;
  }
  return '该订单已超过支付时限，请回到积分商城重新下单。';
}
