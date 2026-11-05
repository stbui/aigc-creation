import { describe, expect, it } from 'vitest';

import { multiFusionCreditCost } from '../../capabilities/definitions/multi_fusion';
import type { BillingDraft } from '../billing/billing.service';
import { scaleMultiFusionDraft } from './task-billing-scale';

const draft = {
  amountMicrocredits: 41_000_000n,
  quantity: 1n,
} as BillingDraft;

describe('scaleMultiFusionDraft', () => {
  it('按变体张数与画质倍率缩放，并保留微积分精度', () => {
    const scaled = scaleMultiFusionDraft(draft, { variantCount: '2', size: '2k' });

    expect(scaled.amountMicrocredits).toBe(41_000_000n);
    expect(scaled.quantity).toBe(2n);
    expect(scaled.amountMicrocredits).toBe(BigInt(multiFusionCreditCost(41, 2, '2k')) * 1_000_000n);
  });

  it('张数收敛到 1-4，未知画质按 1K 计', () => {
    expect(scaleMultiFusionDraft(draft, { variantCount: '99', size: '8k' })).toMatchObject({
      amountMicrocredits: 41_000_000n,
      quantity: 4n,
    });
    expect(scaleMultiFusionDraft(draft, { variantCount: '0', size: 'unknown' })).toMatchObject({
      amountMicrocredits: 10_250_000n,
      quantity: 1n,
    });
  });
});
