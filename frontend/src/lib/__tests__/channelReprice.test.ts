import { describe, expect, it } from 'vitest';
import {
  buildRepriceRows,
  computeRepriceSale,
  formatMarkup,
  isValidMarkup,
  parseSaleInput,
  repriceBlockingModels,
  repricePriceFields,
  saleInputValue,
} from '../channelReprice';
import type { AdminChannelModelView, ChannelModelPriceTierView } from '../../types/model';

/**
 * 统一调价的金额换算是「会算错账」的地方：
 * 成本常低到 0.0002 积分（200 微积分），浮点乘法会在四舍五入时差一个微积分。
 * 这里锁住 half-up 取整、字段子集与规格筛选三条不变量。
 */

function tier(over: Partial<ChannelModelPriceTierView> = {}): ChannelModelPriceTierView {
  return {
    id: 't1',
    selector: {},
    resolution: '*',
    videoSeconds: 0,
    providerModelKey: 'up',
    billingMode: 'fixed_request',
    costPricing: {
      configured: true,
      unitPriceMicrocredits: 200_000,
      inputTokenPriceMicrocredits: 0,
      outputTokenPriceMicrocredits: 0,
      cachedTokenPriceMicrocredits: 0,
    },
    unitPriceMicrocredits: 300_000,
    inputTokenPriceMicrocredits: 0,
    outputTokenPriceMicrocredits: 0,
    cachedTokenPriceMicrocredits: 0,
    priceConfigured: true,
    enabled: true,
    priceVersion: 3,
    ...over,
  };
}

function model(over: Partial<AdminChannelModelView> = {}): AdminChannelModelView {
  return {
    id: 'm1',
    channelId: 'c1',
    modelKey: 'demo',
    providerModelKey: 'demo',
    displayName: '示例模型',
    channelLabel: '线路',
    tags: [],
    description: '',
    sortOrder: 0,
    icon: '',
    capability: 'image',
    protocol: 'p',
    billingMode: 'fixed_request',
    unitPriceMicrocredits: 300_000,
    inputTokenPriceMicrocredits: 0,
    outputTokenPriceMicrocredits: 0,
    cachedTokenPriceMicrocredits: 0,
    priceConfigured: true,
    priceCurrency: 'credits',
    enabled: true,
    priceVersion: 2,
    capabilityVersion: 1,
    capabilityConfig: null,
    priceTiers: [tier()],
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('repricePriceFields', () => {
  it('按次与按时长只提交单价', () => {
    expect(repricePriceFields('image', 'fixed_request').map((f) => f.key)).toEqual([
      'unitPriceMicrocredits',
    ]);
    expect(repricePriceFields('video', 'per_second').map((f) => f.key)).toEqual([
      'unitPriceMicrocredits',
    ]);
  });

  it('Token 计费：视频只算输出，其余三项都要', () => {
    expect(repricePriceFields('video', 'token').map((f) => f.key)).toEqual([
      'outputTokenPriceMicrocredits',
    ]);
    expect(repricePriceFields('text', 'token').map((f) => f.key)).toEqual([
      'inputTokenPriceMicrocredits',
      'outputTokenPriceMicrocredits',
      'cachedTokenPriceMicrocredits',
    ]);
  });
});

describe('isValidMarkup', () => {
  it('接受 0–1000 的两位小数', () => {
    expect(isValidMarkup(0)).toBe(true);
    expect(isValidMarkup(12.34)).toBe(true);
    expect(isValidMarkup(1000)).toBe(true);
  });

  it('拒绝越界与三位小数', () => {
    expect(isValidMarkup(-0.01)).toBe(false);
    expect(isValidMarkup(1000.01)).toBe(false);
    expect(isValidMarkup(1.234)).toBe(false);
    expect(isValidMarkup(Number.NaN)).toBe(false);
  });
});

describe('computeRepriceSale', () => {
  it('按成本加价并取整到所选小数位', () => {
    // 成本 0.2 积分 +20% = 0.24 积分
    expect(computeRepriceSale(200_000, 20, 2)).toBe(240_000);
    // 0.2 × 1.15 = 0.23，浮点下会掉到 0.229999…，必须精确取整
    expect(computeRepriceSale(200_000, 15, 2)).toBe(230_000);
  });

  it('half-up：恰好一半时向上进位', () => {
    // 成本 0.1 积分，+5% = 0.105 → 保留 2 位小数 → 0.11
    expect(computeRepriceSale(100_000, 5, 2)).toBe(110_000);
  });

  it('保留 6 位小数时不做多余取整', () => {
    expect(computeRepriceSale(200_000, 15, 6)).toBe(230_000);
    // 1 微积分 × (1 + 1000%) = 11 微积分
    expect(computeRepriceSale(1, 1000, 6)).toBe(11);
  });

  it('非法输入返回 null', () => {
    expect(computeRepriceSale(-1, 10, 2)).toBeNull();
    expect(computeRepriceSale(100, 1200, 2)).toBeNull();
    expect(computeRepriceSale(100, 10, 7)).toBeNull();
  });

  it('结果超过单价上限返回 null', () => {
    expect(computeRepriceSale(1_000_000_000_000, 1000, 2)).toBeNull();
  });
});

describe('saleInputValue / parseSaleInput', () => {
  it('互为逆运算', () => {
    expect(saleInputValue(240_000)).toBe('0.24');
    expect(saleInputValue(2_000_000)).toBe('2');
    expect(parseSaleInput('0.24')).toBe(240_000);
    expect(parseSaleInput('2')).toBe(2_000_000);
  });

  it('拒绝负数与超过 6 位小数', () => {
    expect(() => parseSaleInput('-1')).toThrow();
    expect(() => parseSaleInput('0.1234567')).toThrow();
    expect(() => parseSaleInput('abc')).toThrow();
  });
});

describe('formatMarkup', () => {
  it('按 (售价 − 成本) ÷ 成本 计算', () => {
    expect(formatMarkup(200_000, 240_000)).toBe('20.00%');
    expect(formatMarkup(0, 240_000)).toBe('—');
    expect(formatMarkup(null, 240_000)).toBe('—');
  });
});

describe('buildRepriceRows', () => {
  it('只取已启用规格，且按计费方式展开字段', () => {
    const rows = buildRepriceRows([
      model({
        priceTiers: [
          tier({ id: 't1' }),
          tier({ id: 't2', enabled: false }),
        ],
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('t1:unitPriceMicrocredits');
    expect(rows[0].cost).toBe(200_000);
    expect(rows[0].sale).toBe('0.3');
    expect(rows[0].tierVersion).toBe(3);
  });

  it('未配置售价的行留空，交由上层拦截', () => {
    const rows = buildRepriceRows([model({ priceTiers: [tier({ priceConfigured: false })] })]);
    expect(rows[0].sale).toBe('');
  });
});

describe('repriceBlockingModels', () => {
  it('缺成本价或售价未确认的模型阻止调价', () => {
    const missingCost = model({ priceTiers: [tier({ costPricing: { ...tier().costPricing, configured: false } })] });
    const missingPrice = model({ priceTiers: [tier({ priceConfigured: false })] });
    const noEnabledTier = model({ priceTiers: [tier({ enabled: false })] });
    expect(repriceBlockingModels([missingCost]).map((m) => m.id)).toEqual(['m1']);
    expect(repriceBlockingModels([missingPrice]).map((m) => m.id)).toEqual(['m1']);
    expect(repriceBlockingModels([noEnabledTier]).map((m) => m.id)).toEqual(['m1']);
    expect(repriceBlockingModels([model()])).toEqual([]);
  });
});
