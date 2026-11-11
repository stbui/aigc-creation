/**
 * 概览页的展示常量与纯函数。
 *
 * 与组件分开，保证时间、金额与渠道文案只有一套口径；这些函数不依赖 React，
 * 可以直接在后续图表或测试中复用。
 */

import { formatDate, formatHm, formatMonthDayTime } from '../../../admin-ui/lib/format';

/** 队列最多列几条：再多就不叫队列，剩下的去任务页筛 */
export const QUEUE_LIMIT = 6;

/** 产出条最多几帧：1440 宽下正好两行 */
export const FRAME_LIMIT = 24;

/** 支付渠道 → 中文。未登记的原样显示，便于发现新增渠道 */
export const CHANNEL_LABELS: Record<string, string> = {
  alipay: '支付宝',
  wechat: '微信支付',
  sandbox: '沙箱',
  unknown: '未记录渠道',
};

/**
 * 队列时刻。
 *
 * 只写 HH:MM 会骗人：队列里的失败可能来自几天前，读起来却像「今天 21:54」。
 * 跨天的行带上月日。是否同一天按北京时间的日期判断 —— 用浏览器本地日期
 * 会让出差在外的运营看到错误的「今天」。
 */
export function queueTime(iso: string): string {
  const date = formatDate(iso);
  if (date === '—') return '—';
  return date === formatDate(new Date().toISOString()) ? formatHm(iso) : formatMonthDayTime(iso);
}

/** 时刻 → HH:MM。后台用 24 小时制，与日志时间对齐 */
export function hhmm(iso: string): string {
  return formatHm(iso);
}

/**
 * 分 → 元。
 *
 * 后端金额一律整数分，展示时才换算 —— 不在接口层做格式化，避免「接口给元、
 * 某处又乘 100」的口径漂移。
 *
 * @param digits 小数位。柱状图上的数字用 0 位，否则刻度会挤成一片
 */
export function yuan(cents: number, digits = 2): string {
  return (cents / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
