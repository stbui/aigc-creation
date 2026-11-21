/**
 * 概览页的展示常量与纯函数。
 *
 * 与组件分开，保证时间、金额与渠道文案只有一套口径；这些函数不依赖 React，
 * 可以直接在后续图表或测试中复用。
 */

import { formatYuanGrouped } from '~/admin-ui/radar';

export { taskErrorLabel } from '../../../lib/admin-error-codes';

/** 支付渠道 → 中文。未登记的原样显示，便于发现新增渠道 */
export const CHANNEL_LABELS: Record<string, string> = {
  alipay: '支付宝',
  wechat: '微信支付',
  sandbox: '沙箱',
  unknown: '未记录渠道',
};

/** 分 → 元。
 *
 * 后端金额一律整数分，展示时才换算 —— 不在接口层做格式化，避免「接口给元、
 * 某处又乘 100」的口径漂移。
 *
 * @param digits 小数位。柱状图上的数字用 0 位，否则刻度会挤成一片
 */
export function yuan(cents: number, digits = 2): string {
  return formatYuanGrouped(cents, digits);
}

export { formatNumber } from '~/admin-ui/radar';
