import { ApiError } from '../../../lib/api';

/**
 * 退款被拒时的错误码 → 运营该做什么。
 *
 * 后端把退款拒绝分成两类：
 *   · 40001 —— **硬约束**：退款金额超过「实付 - 已退」。这是这笔订单本身
 *     的上限，调任何规则都改不动它，只能改金额。
 *   · 40905 / 40906 / 40907 —— **可配规则**：超出可退时间窗、超出比例上限、
 *     应回收积分已被消耗。这三条由后台「支付与退费」工作台决定。
 *
 * 页面上两类过去同形（都是一句错误文案），运营分不清是金额填错还是规则
 * 要改，只能反复试。这里把业务码翻译成可执行的下一步。
 *
 * 码表与后端 `orders/order.service.ts` 的 `assertRefundPolicy` 一一对应。
 */
const REFUND_RULE_CODES = {
  /** 40905：超出可退款时间窗 */
  40905: '已超出可退款时间窗。可在「支付与退费 → 退款处理边界」放宽时间窗，或改走人工审批。',
  /** 40906：超出规则允许的比例上限 */
  40906: '退款金额超出规则允许的比例上限。可在「支付与退费 → 退款处理边界」调整比例上限，或改小退款金额。',
  /** 40907：应回收的积分已被消耗 */
  40907: '本次退款应回收的积分已被消耗，无法从本单扣回。可在「支付与退费 → 退款处理边界」允许带消耗退款。',
} as const;

/**
 * 退款失败的补充提示（不可执行的一律返回 null）。
 *
 * 只认业务码，不看 HTTP 状态码 —— 状态码只能分 400/409，分不出是哪条规则。
 */
export function refundRuleHint(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 40001) {
    return '退款金额超过本单可退上限（实付 - 已退），请改小金额。';
  }
  if (error.code && error.code in REFUND_RULE_CODES) {
    return REFUND_RULE_CODES[error.code as keyof typeof REFUND_RULE_CODES];
  }
  return null;
}

/** 是否是「规则拦的」退款拒绝 —— 用于给出去规则设置的入口 */
export function isRefundRuleRejection(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.code !== null &&
    error.code >= 40905 &&
    error.code <= 40907
  );
}
