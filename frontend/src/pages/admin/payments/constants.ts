import type {
  PaymentCurrency,
  PaymentDisplayStatus,
  PaymentProviderId,
  PaymentSaleStrategy,
} from '../../../types/payment';

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

/** 支付订单筛选状态；顺序与状态映射保持一致。 */
export const PAYMENT_ORDER_STATUS_OPTIONS = (
  Object.entries(PAYMENT_STATUS_META) as Array<
    [PaymentDisplayStatus, (typeof PAYMENT_STATUS_META)[PaymentDisplayStatus]]
  >
).map(([value, meta]) => ({ value, label: meta.label }));

/** 支付订单日期筛选口径。 */
export const PAYMENT_ORDER_TIME_FIELD_OPTIONS = [
  { value: 'created', label: '按下单时间' },
  { value: 'paid', label: '按支付时间' },
  { value: 'credited', label: '按入账时间' },
];

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
  paypal: 'PayPal',
  stripe: 'Stripe',
  epay: '易支付',
  zpay: 'ZPay',
  // 非渠道值，仅用于订单/支付尝试展示：
  manual: '手工核销',
  free: '免费',
};

/** 支付订单可筛选的渠道；后端 assertProviderId 不接受 manual/free */
export const ORDER_PROVIDER_IDS: PaymentProviderId[] = [
  'sandbox',
  'alipay',
  'wechat',
  'paypal',
  'stripe',
  'epay',
  'zpay',
];
export const ORDER_PROVIDERS = ORDER_PROVIDER_IDS.map((id) => ({
  value: id,
  label: PROVIDER_LABELS[id],
}));

/**
 * 对账页保留原有可对账渠道筛选。PayPal / Stripe / 易支付 / ZPay 当前不参与自动
 * 渠道账单下载，不把它们混进对账筛选，避免出现永远为空的选项。
 */
export const RECONCILIATION_PROVIDER_IDS: PaymentProviderId[] = ['sandbox', 'alipay', 'wechat'];
export const RECONCILIATION_PROVIDERS = RECONCILIATION_PROVIDER_IDS.map((id) => ({
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
  const actionable = status === 'created' || status === 'pending' || status === 'create_failed' || status === 'closing';
  return { canQuery: actionable, canClose: actionable };
}

/** 充值商品表单草稿。金额在表单里保留字符串，提交时才换算为整数分。 */
export interface PaymentProductDraft {
  name: string;
  description: string;
  currency: PaymentCurrency;
  /** 元 / 美元，输入用小数，提交前换算成分 */
  price: string;
  originalPrice: string;
  credits: string;
  creditsValidDays: string;
  grantType: 'immediate' | 'manual';
  saleStrategy: PaymentSaleStrategy;
  periodDays: string;
  periodPurchaseLimit: string;
  stockTotal: string;
  saleStartAt: string;
  saleEndAt: string;
  sortOrder: string;
  enabled: boolean;
}

export const EMPTY_PAYMENT_PRODUCT_DRAFT: PaymentProductDraft = {
  name: '',
  description: '',
  currency: 'CNY',
  price: '',
  originalPrice: '',
  credits: '',
  creditsValidDays: '0',
  grantType: 'immediate',
  saleStrategy: 'unlimited',
  periodDays: '30',
  periodPurchaseLimit: '1',
  stockTotal: '0',
  saleStartAt: '',
  saleEndAt: '',
  sortOrder: '0',
  enabled: false,
};

export const PAYMENT_PRODUCT_STRATEGY_OPTIONS: Array<{
  value: PaymentSaleStrategy;
  label: string;
}> = [
  { value: 'unlimited', label: '不限量' },
  { value: 'periodic', label: '周期限购' },
  { value: 'inventory', label: '库存' },
  { value: 'timed', label: '限时' },
];

export const PAYMENT_CURRENCY_OPTIONS: Array<{
  value: PaymentCurrency;
  label: string;
}> = [
  { value: 'CNY', label: '人民币 CNY' },
  { value: 'USD', label: '美元 USD' },
];
