import type { PaymentDisplayStatus, PaymentProviderId } from '../../../types/payment';

/**
 * 支付订单与渠道的状态文案 / 色调映射。
 *
 * 后端 `payment-query.ts` 的 `PAYMENT_DISPLAY_STATUSES` 是状态的唯一事实源 ——
 * 这里只负责**展示**：把后端给的状态值翻译成人话。
 *
 * 不在前端二次推导状态：展示状态含「关单租约过期」「重试成功」这类与时钟
 * 相关的判定，前端再算一遍会与后端不一致，翻页时同一单会忽绿忽灰。
 */
export const PAYMENT_STATUS_META: Record<
  PaymentDisplayStatus,
  { label: string; tone: 'success' | 'danger' | 'warn' | 'brand' | 'muted' }
> = {
  created: { label: '待支付', tone: 'warn' },
  pending: { label: '支付中', tone: 'brand' },
  closing: { label: '关单中', tone: 'warn' },
  create_failed: { label: '发起失败', tone: 'danger' },
  closed: { label: '已关闭', tone: 'muted' },
  credited: { label: '已入账', tone: 'success' },
  refunded: { label: '已退款', tone: 'danger' },
  partial_refunded: { label: '部分退款', tone: 'warn' },
};

/** 支付方式（checkoutMode）→ 中文 */
export const CHECKOUT_MODE_LABELS: Record<string, string> = {
  sandbox: '站内模拟',
  redirect: '网站跳转',
  qrcode: '扫码支付',
};

/** 渠道 id → 中文名。后端也返回 name，那是展示用品牌名；这份是筛选下拉用的短名。 */
export const PROVIDER_LABELS: Record<string, string> = {
  sandbox: '沙箱',
  alipay: '支付宝',
  wechat: '微信支付',
  // 非渠道值，仅用于订单/支付尝试展示：
  manual: '手工核销',
  free: '免费',
};

/** 只有真实渠道可以用于后端筛选（后端 assertProviderId 不接受 manual/free） */
export const FILTERABLE_PROVIDER_IDS: PaymentProviderId[] = ['sandbox', 'alipay', 'wechat'];
export const FILTERABLE_PROVIDERS = FILTERABLE_PROVIDER_IDS.map((id) => ({
  value: id,
  label: PROVIDER_LABELS[id],
}));

/**
 * 订单状态 → 可执行动作。
 *
 * 与后端 `orderDetail()` 的 `actions` 同一口径：终态订单不再提供查单/关单，
 * 避免对着已入账订单点「关闭」这种自相矛盾的操作。
 */
export function paymentActions(status: PaymentDisplayStatus): {
  canQuery: boolean;
  canClose: boolean;
} {
  const actionable =
    status === 'created' ||
    status === 'pending' ||
    status === 'create_failed' ||
    status === 'closing';
  return { canQuery: actionable, canClose: actionable };
}
