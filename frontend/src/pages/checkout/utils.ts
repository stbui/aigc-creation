/**
 * 结算页的纯函数 —— 目录内文件的唯一本页工具来源。
 *
 * 本页的外部依赖 (接口 / 组件 / hook) 分别走 `api.ts` / `components.ts` /
 * `hooks.ts`; 这里只放不依赖 React 的金额、幂等键与试算错误文案换算。
 */

export { formatYuan } from '../../lib/money';

/** 幂等键。crypto.randomUUID 在非安全上下文 (http) 下可能缺失, 故留兜底 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * 券码试算失败时给用户的文案。
 *
 * 分两档: 4xx 是「这张券本身不可用」(把后端原因透出);
 * 其余按网络 / 服务异常处理，并明确仍然可以按原价结算。
 * `couponCode` 为空时返回 null —— 没填券就没有可提示的失败。
 */
export function quoteErrorMessageOf(error: unknown, couponCode: string): string | null {
  if (!couponCode.trim()) return null;
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: number }).status ?? 0)
      : 0;
  const message = error instanceof Error ? error.message : '';
  return status >= 400 && status < 500
    ? `优惠码不可用：${message || '券码不存在或已失效'}`
    : '优惠试算失败，当前按原价结算';
}
