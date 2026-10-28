import { describe, expect, it } from 'vitest';
import { multiFusionCreditCost } from '../multiFusionBilling';

describe('multiFusionCreditCost', () => {
  it('按张数分摊基础价：1K 下 4/3/2/1 张为 40/30/20/10', () => {
    expect([4, 3, 2, 1].map((count) => multiFusionCreditCost(40, count, 1))).toEqual([
      40, 30, 20, 10,
    ]);
  });

  it('画质倍率与张数同时生效', () => {
    expect(multiFusionCreditCost(40, 4, 2)).toBe(80);
    expect(multiFusionCreditCost(40, 4, 3)).toBe(120);
    expect(multiFusionCreditCost(40, 2, 3)).toBe(60);
  });

  it('非法张数收敛到 1-4 张', () => {
    expect(multiFusionCreditCost(40, 0, 1)).toBe(10);
    expect(multiFusionCreditCost(40, 9, 1)).toBe(40);
    expect(multiFusionCreditCost(40, 'not-a-number', 1)).toBe(10);
  });
});
