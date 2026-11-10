import { describe, expect, it } from 'vitest';
import { EMPTY_MODEL_DRAFT } from '../constants';
import { buildPriceTiers } from '../utils';

function draft(unit: string, overrides: Partial<(typeof EMPTY_MODEL_DRAFT.tiers)[0]> = {}) {
  return {
    ...EMPTY_MODEL_DRAFT,
    modelKey: 'seedream-4.0',
    capability: 'image',
    tiers: [{ ...EMPTY_MODEL_DRAFT.tiers[0], unit, ...overrides }],
  };
}

describe('buildPriceTiers 定价声明', () => {
  it('填了非零售价即视为已定价，不再依赖“价格已核对”', () => {
    const result = buildPriceTiers(draft('1.5', { priceConfigured: false }));

    expect('tiers' in result).toBe(true);
    if ('tiers' in result) expect(result.tiers[0].priceConfigured).toBe(true);
  });

  it('0 积分免费商品必须显式声明', () => {
    const unpriced = buildPriceTiers(draft('0', { priceConfigured: false }));
    const free = buildPriceTiers(draft('0', { priceConfigured: true }));

    if ('tiers' in unpriced) expect(unpriced.tiers[0].priceConfigured).toBe(false);
    if ('tiers' in free) expect(free.tiers[0].priceConfigured).toBe(true);
  });

  it('填了成本价即记录成本，不再依赖“同时记录成本”', () => {
    const result = buildPriceTiers(
      draft('1.5', { costConfigured: false, costUnit: '0.8' }),
    );

    expect('tiers' in result).toBe(true);
    if ('tiers' in result) {
      expect(result.tiers[0].costPricing).not.toBeNull();
      expect(result.tiers[0].costPricing?.unitPriceMicrocredits).toBe(800000);
    }
  });
});
