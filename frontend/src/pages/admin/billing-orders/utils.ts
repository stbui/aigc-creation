/**
 * 生成账单的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 金额只在微积分边界换算（`toCredits` / `toCreditsInput`），页面不重算
 * 任何计费口径。
 */

import { toCredits, toCreditsInput } from '../../../lib/microcredits';

export { toCredits, toCreditsInput };

export function formatTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN');
}

/** 可人工核对的状态：已结算 / 已退款只能看，不能再次处置 */
export function canResolveStatus(status: string): boolean {
  return status === 'uncertain' || status === 'reserved' || status === 'running';
}
