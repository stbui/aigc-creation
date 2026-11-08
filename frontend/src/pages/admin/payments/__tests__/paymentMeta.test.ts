import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_MODE_LABELS,
  ORDER_PROVIDER_IDS,
  PAYMENT_STATUS_META,
  PROVIDER_LABELS,
  RECONCILIATION_PROVIDER_IDS,
  paymentActions,
} from '../constants';
import {
  buildPaymentProductPayload,
  creditsText,
  moneyText,
  paymentProductPriceToCents,
  productSaleStatusOf,
  strategyText,
} from '../utils';
import { EMPTY_PAYMENT_PRODUCT_DRAFT } from '../constants';

/**
 * 支付充值的展示口径。
 *
 * 锁住三件事：
 *   1. 状态文案**只在服务端给的展示状态上翻译**，前端不再二次推导 ——
 *      推导一遍就会与后端不一致，翻页时同一单忽绿忽灰；
 *   2. 金额按分存、按元展示，USD 与 CNY 的符号不能错；
 *   3. 终态订单（已入账 / 已退款 / 已关闭）不再提供查单与关单 ——
 *      对着已入账订单点「关闭」是自相矛盾的操作。
 */

describe('PAYMENT_STATUS_META', () => {
  it('覆盖后端给的全部展示状态', () => {
    const statuses = [
      'created',
      'pending',
      'closing',
      'create_failed',
      'closed',
      'credited',
      'refunded',
      'partial_refunded',
    ] as const;
    for (const status of statuses) {
      expect(PAYMENT_STATUS_META[status]).toBeTruthy();
      expect(PAYMENT_STATUS_META[status].label).toBeTruthy();
    }
  });

  it('已入账是成功色，已退款是危险色', () => {
    expect(PAYMENT_STATUS_META.credited.tone).toBe('success');
    expect(PAYMENT_STATUS_META.refunded.tone).toBe('danger');
  });
});

describe('paymentActions', () => {
  it('未终态订单可查单可关单', () => {
    for (const status of ['created', 'pending', 'create_failed', 'closing'] as const) {
      expect(paymentActions(status)).toEqual({
        canQuery: true,
        canClose: true,
      });
    }
  });

  it('终态订单两个动作都没有', () => {
    for (const status of ['closed', 'credited', 'refunded', 'partial_refunded'] as const) {
      expect(paymentActions(status)).toEqual({
        canQuery: false,
        canClose: false,
      });
    }
  });
});

describe('标签映射', () => {
  it('七个支付适配器都有短名', () => {
    expect(PROVIDER_LABELS.sandbox).toBe('沙箱');
    expect(PROVIDER_LABELS.alipay).toBe('支付宝');
    expect(PROVIDER_LABELS.wechat).toBe('微信支付');
    expect(PROVIDER_LABELS.paypal).toBe('PayPal');
    expect(PROVIDER_LABELS.stripe).toBe('Stripe');
    expect(PROVIDER_LABELS.epay).toBe('易支付');
    expect(PROVIDER_LABELS.zpay).toBe('ZPay');
  });

  it('订单筛选包含七渠道，对账筛选仍只保留可自动对账渠道', () => {
    expect(ORDER_PROVIDER_IDS).toEqual(['sandbox', 'alipay', 'wechat', 'paypal', 'stripe', 'epay', 'zpay']);
    expect(RECONCILIATION_PROVIDER_IDS).toEqual(['sandbox', 'alipay', 'wechat']);
  });

  it('三种支付方式都有文案', () => {
    expect(CHECKOUT_MODE_LABELS.sandbox).toBe('站内模拟');
    expect(CHECKOUT_MODE_LABELS.redirect).toBe('网站跳转');
    expect(CHECKOUT_MODE_LABELS.qrcode).toBe('扫码支付');
  });
});

describe('moneyText', () => {
  it('CNY 用 ¥、USD 用 $，都是两位小数', () => {
    expect(moneyText(1000, 'CNY')).toBe('¥10.00');
    expect(moneyText(1000, 'USD')).toBe('$10.00');
    expect(moneyText(0, 'CNY')).toBe('¥0.00');
    expect(moneyText(5, 'CNY')).toBe('¥0.05');
  });
});

describe('creditsText', () => {
  it('有效期 0 表示永久', () => {
    expect(creditsText({ credits: 2000, creditsValidDays: 0 })).toBe('2,000 积分（永久有效）');
  });

  it('有有效期时写天数', () => {
    expect(creditsText({ credits: 2000, creditsValidDays: 30 })).toBe('2,000 积分（30 天有效）');
  });
});

describe('strategyText', () => {
  it('不限量', () => {
    expect(
      strategyText({
        saleStrategy: 'unlimited',
        periodDays: 0,
        periodPurchaseLimit: 0,
        stockTotal: 0,
        stockRemaining: 0,
        saleStartAt: null,
        saleEndAt: null,
      }),
    ).toBe('不限量');
  });

  it('周期策略给天数与限购次数', () => {
    expect(
      strategyText({
        saleStrategy: 'periodic',
        periodDays: 30,
        periodPurchaseLimit: 2,
        stockTotal: 0,
        stockRemaining: 0,
        saleStartAt: null,
        saleEndAt: null,
      }),
    ).toBe('周期 30 天 · 限 2 次');
  });

  it('库存策略给剩余与总量', () => {
    expect(
      strategyText({
        saleStrategy: 'inventory',
        periodDays: 0,
        periodPurchaseLimit: 0,
        stockTotal: 100,
        stockRemaining: 7,
        saleStartAt: null,
        saleEndAt: null,
      }),
    ).toBe('库存 7 / 100');
  });

  it('限时策略截到日期', () => {
    expect(
      strategyText({
        saleStrategy: 'timed',
        periodDays: 0,
        periodPurchaseLimit: 0,
        stockTotal: 0,
        stockRemaining: 0,
        saleStartAt: '2026-11-01T00:00:00.000Z',
        saleEndAt: '2026-11-30T00:00:00.000Z',
      }),
    ).toBe('限时 2026-11-01 ~ 2026-11-30');
  });
});

describe('productSaleStatusOf', () => {
  it('非 active 一律停用', () => {
    expect(
      productSaleStatusOf({
        status: 'offline',
        saleStrategy: 'unlimited',
        saleStartAt: null,
        saleEndAt: null,
        stockRemaining: 10,
      }),
    ).toBe('disabled');
  });

  it('库存售罄', () => {
    expect(
      productSaleStatusOf({
        status: 'active',
        saleStrategy: 'inventory',
        saleStartAt: null,
        saleEndAt: null,
        stockRemaining: 0,
      }),
    ).toBe('sold_out');
  });

  it('限时未开始与已结束分开', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const past = new Date(Date.now() - 86400000).toISOString();
    expect(
      productSaleStatusOf({
        status: 'active',
        saleStrategy: 'timed',
        saleStartAt: future,
        saleEndAt: null,
        stockRemaining: 10,
      }),
    ).toBe('upcoming');
    expect(
      productSaleStatusOf({
        status: 'active',
        saleStrategy: 'timed',
        saleStartAt: null,
        saleEndAt: past,
        stockRemaining: 10,
      }),
    ).toBe('ended');
  });

  it('其余情况在售', () => {
    expect(
      productSaleStatusOf({
        status: 'active',
        saleStrategy: 'unlimited',
        saleStartAt: null,
        saleEndAt: null,
        stockRemaining: 10,
      }),
    ).toBe('on_sale');
  });
});

describe('paymentProductPriceToCents', () => {
  it('元 / 美元文本按两位小数换算为整数分', () => {
    expect(paymentProductPriceToCents('9.90')).toBe(990);
    expect(paymentProductPriceToCents(' 9.9 ')).toBe(990);
    expect(paymentProductPriceToCents('0.01')).toBe(1);
  });

  it('非法或超过两位小数的金额返回 null', () => {
    expect(paymentProductPriceToCents('')).toBeNull();
    expect(paymentProductPriceToCents('9.999')).toBeNull();
    expect(paymentProductPriceToCents('-1')).toBeNull();
    expect(paymentProductPriceToCents('abc')).toBeNull();
  });
});

describe('buildPaymentProductPayload', () => {
  it('按售卖策略只提交对应字段', () => {
    const result = buildPaymentProductPayload(
      {
        ...EMPTY_PAYMENT_PRODUCT_DRAFT,
        name: ' 2000 积分包 ',
        price: '9.90',
        originalPrice: '19.90',
        credits: '2000',
        saleStrategy: 'periodic',
        periodDays: '30',
        periodPurchaseLimit: '2',
      },
      true,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({
      name: '2000 积分包',
      priceCents: 990,
      originalPriceCents: 1990,
      credits: 2000,
      saleStrategy: 'periodic',
      periodDays: 30,
      periodPurchaseLimit: 2,
      status: 'offline',
    });
    expect(result.payload).not.toHaveProperty('stockTotal');
    expect(result.payload).not.toHaveProperty('saleStartAt');
  });

  it('库存策略必须填写正数库存', () => {
    const result = buildPaymentProductPayload(
      {
        ...EMPTY_PAYMENT_PRODUCT_DRAFT,
        price: '9.90',
        credits: '100',
        saleStrategy: 'inventory',
        stockTotal: '0',
      },
      true,
    );

    expect(result).toEqual({
      ok: false,
      error: '库存商品必须填写大于 0 的库存总量',
    });
  });

  it('没有美元渠道时允许保存下架商品，但不能上架', () => {
    const draft = {
      ...EMPTY_PAYMENT_PRODUCT_DRAFT,
      price: '9.90',
      credits: '100',
      currency: 'USD' as const,
    };

    expect(buildPaymentProductPayload(draft, false).ok).toBe(true);
    expect(buildPaymentProductPayload({ ...draft, enabled: true }, false)).toEqual({
      ok: false,
      error: '当前没有已配置的美元支付渠道，无法上架美元商品',
    });
  });
});
