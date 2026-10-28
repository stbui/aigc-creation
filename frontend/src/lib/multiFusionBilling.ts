/**
 * 多图融合变体计费。
 *
 * 能力基础价对应默认的 4 张变体，因此每张单价为 `基础价 / 4`。
 * 参考站 billing-config 的口径是「每张单价 × 张数 × 画质倍率」：
 * `基础价 40` 时，1K 的 4/3/2/1 张分别为 40/30/20/10，2K 翻倍，4K 为 3 倍。
 */
export function multiFusionCreditCost(
  baseCost: number,
  variantCount: unknown,
  resolutionMultiplier: number,
): number {
  const count = Math.max(1, Math.min(4, Math.floor(Number(variantCount) || 1)));
  const multiplier = Number.isFinite(resolutionMultiplier) && resolutionMultiplier > 0
    ? resolutionMultiplier
    : 1;
  return Math.round((baseCost * count * multiplier) / 4);
}
