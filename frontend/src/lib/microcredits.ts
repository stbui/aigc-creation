/**
 * 微积分金额的前端换算。
 *
 * 后端所有价格、账单金额都是**微积分**整数（1 积分 = 1,000,000 微积分），
 * 因为 Token 单价常低到 0.0002 积分 / token，前端若按「元 / 积分」浮点展示
 * 会在批量对账时放大成真实差额。这里只做展示换算与输入解析，不参与计费。
 */

/** 1 积分对应的微积分数量（与后端 `CREDIT_SCALE` 一致） */
export const CREDIT_SCALE = 1_000_000;

/** 微积分 → 积分。去掉尾随 0，整数值不带小数点 */
export function toCredits(microcredits: number): string {
  const value = Number(microcredits ?? 0) / CREDIT_SCALE;
  if (!Number.isFinite(value)) return '0';
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

/** 展示用：`12 积分`，0 时显式写「未配置」由调用方决定，这里给 0 */
export function formatCredits(microcredits: number): string {
  return toCredits(microcredits);
}

/**
 * 积分输入 → 微积分整数。
 *
 * 允许最多 6 位小数；非法输入返回 null（由调用方拦截并提示），
 * 不做「猜一个近似值」—— 价格写错比保存失败贵得多。
 */
export function parseCredits(text: string): number | null {
  const trimmed = String(text ?? '').trim();
  if (trimmed === '') return 0;
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  const padded = (fraction + '000000').slice(0, 6);
  return Number(whole) * CREDIT_SCALE + Number(padded);
}

/** 微积分 → 输入框文本（与 `parseCredits` 互逆） */
export function toCreditsInput(microcredits: number): string {
  return toCredits(microcredits);
}

/** 万分比 → 百分比数字文本（9500 → 95） */
export function bpsToPercentText(bps: number): string {
  return String(Math.round(Number(bps ?? 0) / 100));
}
