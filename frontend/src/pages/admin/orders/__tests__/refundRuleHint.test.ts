import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../../lib/api';
import { isRefundRuleRejection, refundRuleHint } from '../refundRuleHint';

/**
 * 退款被拒的业务码 → 提示。
 *
 * 码表与后端 `orders/order.service.ts` 的 `assertRefundPolicy` 对应：
 * 40001 是硬约束（金额超上限），40905/40906/40907 是可配规则。
 */
describe('refundRuleHint', () => {
  it('40001 提示改金额，不指向规则设置', () => {
    const error = new ApiError('退款金额超出可退: 最多 990 分', 400, { code: 40001 });
    const hint = refundRuleHint(error);
    expect(hint).toContain('改小金额');
    expect(hint).not.toContain('系统设置');
  });

  it('40905/40906/40907 各自指向对应的那条规则', () => {
    const window = refundRuleHint(new ApiError('超出时间窗', 409, { code: 40905 }));
    expect(window).toContain('时间窗');

    const ratio = refundRuleHint(new ApiError('超出规则上限', 409, { code: 40906 }));
    expect(ratio).toContain('比例上限');

    const consumed = refundRuleHint(new ApiError('积分已消耗', 409, { code: 40907 }));
    expect(consumed).toContain('已被消耗');
  });

  it('规则类拒绝才指向规则设置入口', () => {
    expect(isRefundRuleRejection(new ApiError('x', 409, { code: 40906 }))).toBe(true);
    expect(isRefundRuleRejection(new ApiError('x', 400, { code: 40001 }))).toBe(false);
  });

  it('非 ApiError 或无业务码时不给提示', () => {
    expect(refundRuleHint(new Error('网络断了'))).toBeNull();
    expect(refundRuleHint(new ApiError('x', 409))).toBeNull();
  });
});
