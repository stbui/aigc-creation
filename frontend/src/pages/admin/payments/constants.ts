import type {
  PaymentCurrency,
  PaymentDisplayStatus,
  PaymentExceptionStatus,
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

/**
 * 支付订单筛选草稿。
 *
 * 筛选条是「草稿 → 应用」两段式：输入期间只改草稿，点「查询」才写入查询
 * 参数与地址栏。类型放常量层是为了让 `hooks.ts` 与筛选条共用同一份形状，
 * 不必从组件反向取类型。
 */
export type PaymentOrderFilterValues = {
  keyword: string;
  status?: PaymentDisplayStatus;
  providerId?: string;
  timeField?: string;
  from: string;
  to: string;
};

export type PaymentOrderFilterKey = keyof PaymentOrderFilterValues;

/** 重置后的空条件。 */
export const EMPTY_PAYMENT_ORDER_FILTERS: PaymentOrderFilterValues = {
  keyword: '',
  status: undefined,
  providerId: undefined,
  timeField: undefined,
  from: '',
  to: '',
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
 * 对账深链允许的渠道 id。
 *
 * 页面上的渠道下拉取自 `GET /admin/payments/providers` 的实时能力（支持对账且
 * 已配置），这份静态清单只用于校验 URL 里的 `?providerId=`，避免手改地址栏
 * 注入任意字符串。PayPal / Stripe / 易支付 / ZPay 不参与自动渠道账单下载，
 * 不放进白名单。
 */
export const RECONCILIATION_PROVIDER_IDS: PaymentProviderId[] = ['sandbox', 'alipay', 'wechat'];

/** 对账运行状态 → 展示文案 / 色调。 */
export const RECONCILIATION_RUN_STATUS_META: Record<
  'running' | 'completed' | 'failed',
  { label: string; tone: 'success' | 'danger' | 'brand' }
> = {
  running: { label: '执行中', tone: 'brand' },
  completed: { label: '已完成', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
};

/** 对账运行筛选状态；从状态映射派生，避免文案维护两份。 */
export const RECONCILIATION_RUN_STATUS_OPTIONS = Object.entries(
  RECONCILIATION_RUN_STATUS_META,
).map(([value, meta]) => ({ value, label: meta.label }));

/**
 * 对账页唯一一套查询条件：渠道 + 账单日 + 状态。
 *
 * 渠道与账单日同时是「执行对账」的入参 —— 页面上不再另起一套执行区，避免
 * 同一屏出现两个渠道下拉、两个日期控件且口径可能不一致。
 */
export type ReconciliationFilterValues = {
  providerId?: string;
  status?: string;
  /** 单日账单，空串表示不按账单日过滤（此时也不能执行对账） */
  billDate: string;
};

export type ReconciliationFilterKey = keyof ReconciliationFilterValues;

/** 重置后的空条件。 */
export const EMPTY_RECONCILIATION_FILTERS: ReconciliationFilterValues = {
  providerId: undefined,
  status: undefined,
  billDate: '',
};

/**
 * 支付异常单的状态 / 差异类型 / 筛选条件。
 *
 * 异常队列是「真资金差异」的兜底入口，状态文案只在这里维护一份；页面与
 * hook 都从这里取，筛选下拉、chips 与列表标签不会各写一份而漂移。
 */
export const PAYMENT_EXCEPTION_STATUS_META: Record<
  PaymentExceptionStatus,
  { label: string; tone: 'success' | 'danger' | 'warn' | 'brand' | 'muted' }
> = {
  open: { label: '待处理', tone: 'warn' },
  auto_refund_pending: { label: '退款处理中', tone: 'brand' },
  refunded: { label: '已退款', tone: 'success' },
  manual_review: { label: '需人工核对', tone: 'danger' },
  closed: { label: '已结案', tone: 'muted' },
};

export const PAYMENT_EXCEPTION_STATUS_OPTIONS = Object.entries(
  PAYMENT_EXCEPTION_STATUS_META,
).map(([value, meta]) => ({ value, label: meta.label }));

/** 差异类型 → 中文；后端新增类型时前端自动回落原值，不阻塞展示。 */
export const PAYMENT_EXCEPTION_KIND_LABELS: Record<string, string> = {
  cancelled_but_paid: '已取消仍扣款',
  refund_failed: '退款失败',
  refund_processing: '退款异步处理中',
  auto_reconcile_failed: '自动对账失败',
  local_order_not_found: '本地订单缺失',
  provider_record_missing: '渠道流水缺失',
  amount_mismatch: '金额不一致',
  trade_no_mismatch: '交易号不一致',
  duplicate_charge: '疑似重复扣款',
  credit_failed: '补发积分失败',
};

export const PAYMENT_EXCEPTION_PRIORITY_OPTIONS = [
  { value: 'urgent', label: '紧急' },
  { value: 'normal', label: '普通' },
];

export const PAYMENT_EXCEPTION_OVERDUE_OPTIONS = [
  { value: 'true', label: '仅看逾期' },
  { value: 'false', label: '全部 SLA' },
];

/** 异常单筛选草稿；`overdue` 保留下拉的字符串值，提交时才转布尔。 */
export type PaymentExceptionFilterValues = {
  status?: string;
  providerId?: string;
  priority?: string;
  overdue?: string;
};

export type PaymentExceptionFilterKey = keyof PaymentExceptionFilterValues;

export const EMPTY_PAYMENT_EXCEPTION_FILTERS: PaymentExceptionFilterValues = {
  status: undefined,
  providerId: undefined,
  priority: undefined,
  overdue: undefined,
};

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
