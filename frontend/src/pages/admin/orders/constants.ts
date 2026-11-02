/**
 * 订单管理的状态、渠道与退款选项表。
 *
 * 退款状态值必须与后端 `REFUND_STATES` 白名单一致；渠道中文是展示口径，
 * 未登记取值由界面原样显示。
 */

export const STATUS_OPTIONS = [
  { value: 'pending', label: '待支付' },
  { value: 'paid', label: '已支付' },
  { value: 'cancelled', label: '已取消' },
  { value: 'refunded', label: '已退款' },
  { value: 'partial_refunded', label: '部分退款' },
];

/**
 * 订单状态标签的文案覆盖。
 *
 * 与任务状态共用 `pending` 这个值: 任务的 pending 是「等待执行」,
 * 订单的 pending 是「待支付」—— 共用键没法在映射表里同时正确。
 */
export const STATUS_LABEL_OVERRIDE: Record<string, string> = { pending: '待支付' };

/**
 * 退款状态 → 中文 (2026-10-22)。
 *
 * 退款不再是「按下即完成」: 渠道可能异步处理 (`processing`) 或拒绝 (`failed`)。
 * 未知值原样显示 —— 后端新增状态时不该被这个映射静默吞掉。
 */
export const REFUND_STATUS_LABELS: Record<string, string> = {
  succeeded: '退款成功',
  processing: '渠道处理中',
  failed: '退款失败',
};

/** 退款状态筛选项。值必须与后端 `REFUND_STATES` 白名单一致 */
export const REFUND_STATE_OPTIONS = [
  { value: 'processing', label: '渠道处理中' },
  { value: 'failed', label: '退款失败' },
  { value: 'succeeded', label: '退款成功' },
];

/** 渠道 → 中文。未知渠道原样显示, 便于发现未登记的取值 */
export const CHANNEL_LABELS: Record<string, string> = {
  sandbox: '沙箱',
  manual: '手工核销',
  alipay: '支付宝',
  wechat: '微信支付',
};

export const CHANNEL_OPTIONS = Object.entries(CHANNEL_LABELS).map(([value, label]) => ({
  value,
  label,
}));
