import { multiFusionCreditMultiplier } from '../../capabilities/definitions/multi_fusion';
import type { BillingDraft } from '../billing/billing.service';

/**
 * 多图融合按「张数 × 画质倍率」放缩账单草案。
 *
 * 准入建首单与换线重建账单必须共用这里，否则同一任务在切换线路后会按默认
 * 4 张 1K 的价格收费。金额保留微积分精度，只在最后向 4 张档位归一。
 */
export function scaleMultiFusionDraft(
  draft: BillingDraft,
  params: Record<string, unknown>,
): BillingDraft {
  const count = Math.max(1, Math.min(4, Math.floor(Number(params.variantCount) || 1)));
  const multiplier = BigInt(multiFusionCreditMultiplier(params.size));
  return {
    ...draft,
    amountMicrocredits:
      (draft.amountMicrocredits * BigInt(count) * multiplier + 3n) / 4n,
    quantity: draft.quantity * BigInt(count),
  };
}
