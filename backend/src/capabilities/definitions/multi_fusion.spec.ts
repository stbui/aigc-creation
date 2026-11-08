import { describe, expect, it } from 'vitest';

import { multiFusionCreditCost } from './multi_fusion';

describe('multiFusionCreditCost', () => {
  it('公开展示价与最终计费一致，小数向上取整', () => {
    expect(multiFusionCreditCost(41, 1, '1k')).toBe(11);
    expect(multiFusionCreditCost(41, 3, '1k')).toBe(31);
  });

  it('张数与画质倍率同时生效', () => {
    expect(multiFusionCreditCost(40, 4, '2k')).toBe(80);
    expect(multiFusionCreditCost(40, 2, '4k')).toBe(60);
  });
});
