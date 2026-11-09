import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_MODE_LABELS,
  ORDER_PROVIDER_IDS,
  PAYMENT_EXCEPTION_STATUS_META,
  PAYMENT_EXCEPTION_STATUS_OPTIONS,
  PROVIDER_LABELS,
  RECONCILIATION_PROVIDER_IDS,
  RECONCILIATION_RUN_STATUS_META,
  RECONCILIATION_RUN_STATUS_OPTIONS,
} from '../constants';
import {
  allowedPaymentMethods,
  instanceState,
  missingRequiredLabels,
  moneyText,
  providerLabel,
  providerState,
  providerWithInstances,
  sourceAvailability,
  sourceAvailableInstances,
  togglePaymentMethod,
} from '../utils';
import type {
  AdminPaymentProviderInstanceView,
  AdminPaymentProviderView,
  PaymentConfigField,
} from '../../../../types/payment';

/**
 * 支付域（渠道 / 对账 / 异常）的展示口径。
 *
 * 锁住两件事：
 *   1. 状态与筛选项的文案只维护一份，页面与钩子都从常量层取；
 *   2. 金额按分存、按元展示，USD 与 CNY 的符号不能错。
 *
 * 支付订单与充值商品不在本模块：订单并入「订单管理」（`/admin/orders`），
 * 商品并入「商品管理」（`/admin/products`）。
 */

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

  it('订单筛选包含七渠道，对账深链白名单仍只保留可自动对账渠道', () => {
    expect(ORDER_PROVIDER_IDS).toEqual(['sandbox', 'alipay', 'wechat', 'paypal', 'stripe', 'epay', 'zpay']);
    expect(RECONCILIATION_PROVIDER_IDS).toEqual(['sandbox', 'alipay', 'wechat']);
  });

  it('对账状态筛选项由状态映射派生，文案只维护一份', () => {
    expect(RECONCILIATION_RUN_STATUS_OPTIONS).toEqual(
      Object.entries(RECONCILIATION_RUN_STATUS_META).map(([value, meta]) => ({
        value,
        label: meta.label,
      })),
    );
  });

  it('三种支付方式都有文案', () => {
    expect(CHECKOUT_MODE_LABELS.sandbox).toBe('站内模拟');
    expect(CHECKOUT_MODE_LABELS.redirect).toBe('网站跳转');
    expect(CHECKOUT_MODE_LABELS.qrcode).toBe('扫码支付');
  });

  it('渠道短名缺失时原样返回，空值显示占位符', () => {
    expect(providerLabel('alipay')).toBe('支付宝');
    expect(providerLabel('unknown-provider')).toBe('unknown-provider');
    expect(providerLabel(null)).toBe('—');
  });

  it('支付异常状态与筛选项只维护一份文案', () => {
    expect(Object.keys(PAYMENT_EXCEPTION_STATUS_META)).toEqual([
      'open',
      'auto_refund_pending',
      'refunded',
      'manual_review',
      'closed',
    ]);
    expect(PAYMENT_EXCEPTION_STATUS_OPTIONS).toEqual(
      Object.entries(PAYMENT_EXCEPTION_STATUS_META).map(([value, meta]) => ({
        value,
        label: meta.label,
      })),
    );
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

/**
 * 渠道配置的草稿态校验。
 *
 * 锁住一个真实 bug：必填项提示原先基于**已保存的配置**（`provider.missing`），
 * 而不是当前草稿。后果是「刚补上必填项提示还挂着」「清空必填项提示不出现，
 * 点保存才报 400」。
 */
describe('missingRequiredLabels', () => {
  const fields: PaymentConfigField[] = [
    { name: 'pid', label: '商户 ID（pid）', type: 'text', required: true },
    {
      name: 'key',
      label: '商户密钥',
      type: 'password',
      required: true,
      secret: true,
    },
    { name: 'cid', label: '支付渠道 ID（可选）', type: 'text', required: false },
  ];

  it('必填项缺失时返回字段标签', () => {
    expect(
      missingRequiredLabels(fields, { pid: '', key: '' }, { key: false }),
    ).toEqual(['商户 ID（pid）', '商户密钥']);
  });

  it('草稿补齐后不再报缺失 —— 修的是「刚补上提示还挂着」', () => {
    expect(
      missingRequiredLabels(fields, { pid: '123', key: '' }, { key: false }),
    ).toEqual(['商户密钥']);
  });

  it('密字段留空表示沿用旧值，旧值存在就不算缺失', () => {
    expect(
      missingRequiredLabels(fields, { pid: '123', key: '' }, { key: true }),
    ).toEqual([]);
  });

  it('非必填项不参与判定', () => {
    expect(
      missingRequiredLabels(fields, { pid: '123', key: 'k' }, { key: true }),
    ).toEqual([]);
  });
});


/**
 * 多实例支付渠道的纯函数规则。
 *
 * 这里锁住两条最容易悄悄回归的产品语义：
 *   1. 前台按钮只按选定来源判断，官方不可用时绝不能自动回退到易支付；
 *   2. 渠道状态与可收款实例数量必须按 `instances[]` 聚合，不能只看顶层兼容字段。
 */
describe('多实例支付渠道规则', () => {
  function instance(
    overrides: Partial<AdminPaymentProviderInstanceView> = {},
  ): AdminPaymentProviderInstanceView {
    return {
      instanceId: 'default',
      providerId: 'alipay',
      name: null,
      sortOrder: 0,
      enabled: true,
      configured: true,
      closeAfterMinutes: 30,
      version: 1,
      configId: 'cfg-1',
      values: {},
      secretConfigured: {},
      minAmountCents: null,
      maxAmountCents: null,
      dailyLimitCents: null,
      refundEnabled: true,
      paymentMethods: ['alipay'],
      identityLockedFields: [],
      hasOpenOrders: false,
      updatedAt: null,
      warnings: [],
      ...overrides,
    };
  }

  function provider(
    overrides: Partial<AdminPaymentProviderView> = {},
  ): AdminPaymentProviderView {
    const instances = overrides.instances ?? [instance()];
    const first = instances[0];
    return {
      id: 'alipay',
      name: '支付宝官方',
      icon: 'alipay',
      checkoutMode: 'qrcode',
      enabled: instances.some((item) => item.enabled),
      configured: instances.some((item) => item.configured),
      closeAfterMinutes: first?.closeAfterMinutes ?? 30,
      version: first?.version ?? null,
      configId: first?.configId ?? null,
      configEnabled: first?.enabled ?? false,
      values: first?.values ?? {},
      secretConfigured: first?.secretConfigured ?? {},
      configFields: [],
      supportedCurrencies: ['CNY'],
      supportsReconciliation: false,
      missing: [],
      identityLockedFields: [],
      hasOpenOrders: false,
      updatedAt: null,
      warnings: first?.warnings ?? [],
      ...overrides,
      instances,
    };
  }

  it('实例状态按启用与配置完整性分为四档', () => {
    expect(instanceState(instance())).toBe('usable');
    expect(instanceState(instance({ configured: false }))).toBe('misconfigured');
    expect(instanceState(instance({ enabled: false }))).toBe('disabled');
    expect(
      instanceState(instance({ enabled: false, configured: false })),
    ).toBe('unconfigured');
    expect(
      instanceState(
        instance({ warnings: [{ level: 'danger', message: '证书过期' }] }),
      ),
    ).toBe('misconfigured');
  });

  it('渠道状态按实例聚合，任一可用实例即可收款', () => {
    expect(
      providerState(
        provider({
          instances: [
            instance({ instanceId: 'ready' }),
            instance({
              instanceId: 'disabled',
              enabled: false,
              configured: false,
            }),
          ],
        }),
      ),
    ).toBe('usable');
    expect(
      providerState(
        provider({
          instances: [
            instance({ configured: false }),
            instance({ instanceId: 'off', enabled: false }),
          ],
        }),
      ),
    ).toBe('misconfigured');
    expect(
      providerState(
        provider({
          instances: [
            instance({ instanceId: 'off', enabled: false }),
            instance({
              instanceId: 'empty',
              enabled: false,
              configured: false,
            }),
          ],
        }),
      ),
    ).toBe('disabled');
    expect(providerState(provider({ instances: [] }))).toBe('unconfigured');
  });

  it('前台实例只取当前来源内、启停/配置/支付方式都符合条件的实例', () => {
    const ready = instance({ instanceId: 'ready' });
    const result = sourceAvailableInstances(
      [
        provider({
          instances: [
            ready,
            instance({ instanceId: 'off', enabled: false }),
            instance({ instanceId: 'wechat-only', paymentMethods: ['wechat'] }),
            instance({
              instanceId: 'danger',
              warnings: [{ level: 'danger', message: '密钥失效' }],
            }),
          ],
        }),
        provider({
          id: 'epay',
          name: '易支付',
          instances: [instance({ providerId: 'epay', instanceId: 'epay-1' })],
        }),
      ],
      'CNY',
      'alipay',
      'official',
    );

    expect(result.provider?.id).toBe('alipay');
    expect(result.instances.map((item) => item.instanceId)).toEqual(['ready']);
  });

  it('未选择官方时不会跨来源回退到易支付', () => {
    const epay = provider({
      id: 'epay',
      name: '易支付',
      instances: [
        instance({
          providerId: 'epay',
          instanceId: 'epay-1',
          paymentMethods: ['alipay'],
        }),
      ],
    });

    expect(sourceAvailableInstances([epay], 'CNY', 'alipay', 'official')).toEqual({
      provider: null,
      instances: [],
    });
    expect(sourceAvailability([epay], 'CNY', 'alipay', 'official')).toEqual({
      ok: false,
      reason: '尚未创建对应官方渠道',
    });

    const official = provider();
    expect(sourceAvailability([official], 'CNY', 'alipay', 'epay')).toEqual({
      ok: false,
      reason: '尚未创建易支付渠道',
    });
  });

  it('来源选定但实例全部停用或配置不完整时不可用', () => {
    const disabled = provider({
      instances: [instance({ enabled: false })],
    });
    expect(sourceAvailability([disabled], 'CNY', 'alipay', 'official')).toEqual({
      ok: false,
      reason: '支付宝官方没有已启用的支付宝实例',
    });

    const missing = provider({
      instances: [instance({ configured: false })],
    });
    expect(sourceAvailability([missing], 'CNY', 'alipay', 'official')).toEqual({
      ok: false,
      reason: '支付宝官方的已启用实例配置不完整',
    });
  });

  it('支付方式至少保留一种，且官方实例不会获得跨渠道选项', () => {
    expect(allowedPaymentMethods('alipay')).toEqual(['alipay']);
    expect(allowedPaymentMethods('wechat')).toEqual(['wechat']);
    expect(allowedPaymentMethods('epay')).toEqual(['alipay', 'wechat']);
    expect(togglePaymentMethod(['alipay'], 'alipay', ['alipay'])).toEqual(['alipay']);
    expect(togglePaymentMethod(['alipay'], 'wechat', ['alipay'])).toEqual(['alipay']);
    expect(
      togglePaymentMethod(['alipay'], 'wechat', ['alipay', 'wechat']),
    ).toEqual(['alipay', 'wechat']);
    expect(
      togglePaymentMethod(['alipay', 'wechat'], 'alipay', ['alipay', 'wechat']),
    ).toEqual(['wechat']);
  });

  it('本地保存实例后同步重建渠道兼容投影', () => {
    const next = providerWithInstances(
      provider({ instances: [instance({ instanceId: 'a' })] }),
      [
        instance({ instanceId: 'b', sortOrder: 20, enabled: false }),
        instance({ instanceId: 'a', sortOrder: 10, name: '主实例' }),
      ],
    );

    expect(next.instances.map((item) => item.instanceId)).toEqual(['a', 'b']);
    expect(next.enabled).toBe(true);
    expect(next.configured).toBe(true);
    expect(next.closeAfterMinutes).toBe(30);
  });
});
