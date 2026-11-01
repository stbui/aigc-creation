import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatMarkupPercent,
  markupPercent,
  priceFields,
  specificationLabel,
  tierPriceLines,
} from '../channelCost';
import type { ChannelModelPriceTierView } from '../../types/model';

/**
 * 成本价 / 销售价 / 加价率的展示口径。
 *
 * 锁住三条不变量：
 *   1. **成本为 0 时加价率无意义** —— 显示「—」而不是除零后的 Infinity；
 *   2. 未配置的价显示「未配置」，不显示 0 —— 0 是「免费」，两者含义不同；
 *   3. 参与售价的字段随计费方式变化（与 `channelReprice.repricePriceFields`
 *      同口径，两处漂移会让调价与展示对不上）。
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
    priceVersion: 1,
    ...over,
  };
}

describe('priceFields', () => {
  it('按次与按时长只算单价', () => {
    expect(priceFields('image', 'fixed_request').map((f) => f.key)).toEqual([
      'unitPriceMicrocredits',
    ]);
    expect(priceFields('video', 'per_second')[0].unit).toBe('秒');
  });

  it('Token 计费：视频只算视频 Token，其余模态算三项', () => {
    expect(priceFields('video', 'token').map((f) => f.key)).toEqual([
      'outputTokenPriceMicrocredits',
    ]);
    expect(priceFields('text', 'token').map((f) => f.key)).toEqual([
      'inputTokenPriceMicrocredits',
      'outputTokenPriceMicrocredits',
      'cachedTokenPriceMicrocredits',
    ]);
  });
});

describe('specificationLabel', () => {
  it('翻译作业类型与分辨率', () => {
    expect(
      specificationLabel(
        tier({ selector: { operation: 'text_to_image', vquality: '2k' } }),
      ),
    ).toBe('文生图 · 2K');
  });

  it('视频档带时长', () => {
    expect(specificationLabel(tier({ videoSeconds: 5 }))).toBe('5 秒');
  });

  it('没有规格时回落「默认规格」', () => {
    expect(specificationLabel(tier())).toBe('默认规格');
  });
});

describe('markupPercent', () => {
  it('按（售价 − 成本）÷ 成本计算', () => {
    expect(markupPercent(200_000, 300_000)).toBeCloseTo(50, 6);
  });

  it('成本为 0 时返回 null（不显示无穷大）', () => {
    expect(markupPercent(0, 300_000)).toBeNull();
    expect(formatMarkupPercent(0, 300_000)).toBe('—');
  });

  it('未配置的价返回 null', () => {
    expect(markupPercent(null, 300_000)).toBeNull();
    expect(markupPercent(200_000, null)).toBeNull();
  });
});

describe('tierPriceLines', () => {
  it('只取已启用的价格档', () => {
    const lines = tierPriceLines('image', [tier(), tier({ id: 't2', enabled: false })]);
    expect(lines).toHaveLength(1);
  });

  it('成本未配置时为 null', () => {
    const lines = tierPriceLines('image', [
      tier({ costPricing: { ...tier().costPricing, configured: false } }),
    ]);
    expect(lines[0].cost).toBeNull();
  });
});

describe('formatAmount', () => {
  it('微积分换算成积分文本', () => {
    expect(formatAmount(200_000)).toBe('0.2');
    expect(formatAmount(1_000_000)).toBe('1');
  });

  it('未配置显示「未配置」而不是 0', () => {
    expect(formatAmount(null)).toBe('未配置');
  });
});
