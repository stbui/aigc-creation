/**
 * 后台展示层共用的金额格式（分 → 元字符串）。
 *
 * 工作台与全局搜索的卡片标题都要拼 `¥${...}`，两处原本各写一份私有 `yuan()`。
 *
 * 注意：`common/csv.ts` 的 `centsToYuan` 会先 `Math.round(cents)`，是导出口径；
 * 这里保持展示口径，直接 `/100`。两者对非整数分的结果不同，不要合并，也不要互相替换。
 */
export function yuan(cents: number): string {
  return (cents / 100).toFixed(2);
}
