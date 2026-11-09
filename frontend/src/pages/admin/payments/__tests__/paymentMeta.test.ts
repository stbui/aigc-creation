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
import { missingRequiredLabels, moneyText, providerLabel } from '../utils';
import type { PaymentConfigField } from '../../../../types/payment';

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
