import type { TagTone } from '../../../components/admin/statusMeta';

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

/**
 * 退款状态聚合（与后端 `latestRefundState` 同规则）。
 *
 * 一笔订单可能有多笔退款单（部分退款按笔落库），同一笔退款的渠道重试是
 * 同一行改状态。列上只显示一个值，取**最需要人管的那个**：处理中 > 失败 > 成功。
 *
 * 与筛选口径（`?refundState=failed` 用 `some` 命中任意一笔退款单）同源：
 * 筛得到的行，列上一定看得到原因，不会出现「筛出来是空的」。
 */
export function aggregateRefundState(
  statuses: string[],
): 'processing' | 'failed' | 'succeeded' | null {
  let state: 'processing' | 'failed' | 'succeeded' | null = null;
  for (const status of statuses) {
    if (status === 'processing') return 'processing';
    if (status === 'failed') state = 'failed';
    else if (status === 'succeeded' && !state) state = 'succeeded';
  }
  return state;
}

/**
 * 退款状态 → 色调。
 *
 * 退款状态是独立状态机（`processing` / `failed` / `succeeded`），与任务状态
 * 共用 `failed` / `succeeded` 两个词但语义不同 —— 任务失败是这次生成没成，
 * 退款失败是钱没退回去，后者更重。因此色调在域内单独定，不查 `STATUS_META`。
 */
export const REFUND_STATE_TONES: Record<string, TagTone> = {
  processing: 'warn',
  failed: 'danger',
  succeeded: 'success',
};

/**
 * 支付流水状态 → 中文（2026-11-11）。
 *
 * 详情里的流水原先只用圆点颜色区分成功/未成功 —— 颜色是唯一的编码，
 * 读屏和色弱用户拿不到信息，也说不清一条 `ZPay · ¥27.30` 到底是成功、
 * 失败还是已关闭。状态必须有一份文字。
 */
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: '待支付',
  succeeded: '支付成功',
  failed: '支付失败',
  closed: '已关闭',
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
  paypal: 'PayPal',
  stripe: 'Stripe',
  epay: '易支付',
  zpay: 'ZPay',
};

export const CHANNEL_OPTIONS = Object.entries(CHANNEL_LABELS).map(([value, label]) => ({
  value,
  label,
}));
