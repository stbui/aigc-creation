import { useCapabilities } from './useCapabilities';

/**
 * 能力的实时消耗价文案 (2026-10-20)。
 *
 * 单一事实源在后端 registry + SystemSetting 覆盖, 前端只负责把数字变成人话 ——
 * **不再在 8 个工具页各写一份「本次消耗5积分」**, 那种写法改一次价要改 8 处,
 * 漏一处就是「A 页说 5, B 页说 10, 实际扣 10」。
 *
 * 文案规则:
 *   0  → 「免费」  (不限时能力如实说免费; 「限时免费」是运营话术, 不在此编造)
 *   >0 → 「本次消耗 N 积分」
 *
 * ⚠ 返回 null 表示能力清单还没到 (loading)。调用方此时**不应显示任何价格** ——
 * 显示 0 会被读成「免费」, 用户提交后才发现要扣钱。
 */
export function useCreditLabel(capabilityId: string): string | null {
  const { data } = useCapabilities();
  if (!data) return null;
  const def = data.items.find((c) => c.id === capabilityId);
  if (!def) return null;
  const cost = def.creditCost ?? 0;
  return cost > 0 ? `本次消耗 ${cost} 积分` : '免费';
}

/**
 * 当前能力消耗价 (数字)。
 *
 * 提交前用它判断余额是否够 —— 后端是唯一裁决方, 这里只做**提前提示**,
 * 不做拦截。竞态下余额可能已被别的请求扣掉, 最终仍以后端 402 为准。
 */
export function useCreditCost(capabilityId: string): number | null {
  const { data } = useCapabilities();
  if (!data) return null;
  return data.items.find((c) => c.id === capabilityId)?.creditCost ?? null;
}