import type {
  PaymentExceptionStatus,
  PaymentProviderId,
  VisiblePaymentMethod,
} from '../../../types/payment';

/**
 * 支付域（渠道 / 对账 / 异常）的展示文案与筛选白名单。
 *
 * 支付订单的状态与筛选不在这里：订单页（`/admin/orders`）沿用订单自身的状态
 * 口径，支付域只负责渠道、对账与异常。
 */

/** 支付方式（checkoutMode）→ 中文 */
export const CHECKOUT_MODE_LABELS: Record<string, string> = {
  sandbox: '站内模拟',
  redirect: '网站跳转',
  qrcode: '扫码支付',
  'qrcode-image': '二维码图片',
};

/** C 端两个可见支付按钮的统一文案。 */
export const PAYMENT_METHOD_LABELS: Record<VisiblePaymentMethod, string> = {
  alipay: '支付宝',
  wechat: '微信支付',
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

/**
 * 支付渠道的**可运营状态**。
 *
 * 「启用」不是状态，是开关。把开关直接当状态显示会掩盖真正危险的那一档：
 * 渠道开关是开的、但必填项没配齐时，页面亮起绿色「启用」，实际发起支付直接
 * 503。运营只会看到「启用」，看不到「启用 ≠ 能收钱」。
 *
 * 四档按**能不能收钱**划，而不是按开关划：
 *   · usable        —— 开关开 + 凭据齐，能收钱
 *   · misconfigured —— 开关开 + 凭据缺，正在报错（最危险，必须显眼）
 *   · unconfigured  —— 开关关 + 凭据缺，启用前要补齐
 *   · disabled      —— 开关关 + 凭据齐，随时可启用
 */
export type PaymentProviderState =
  | 'usable'
  | 'misconfigured'
  | 'unconfigured'
  | 'disabled';

export const PAYMENT_PROVIDER_STATE_META: Record<
  PaymentProviderState,
  { label: string; tone: 'success' | 'danger' | 'warn' | 'muted'; hint: string }
> = {
  usable: {
    label: '可收款',
    tone: 'success',
    hint: '通道资料齐全且已启用，客户可以正常付款',
  },
  misconfigured: {
    label: '收款异常',
    tone: 'danger',
    hint: '已有付款受影响，需要尽快处理报错通道',
  },
  unconfigured: {
    label: '待开通',
    tone: 'warn',
    hint: '收款准备尚未完成，当前不会承接客户付款',
  },
  disabled: {
    label: '已停用',
    tone: 'muted',
    hint: '凭据齐全但未启用，随时可以开启',
  },
};

/** 异常单可筛选的渠道；后端 assertProviderId 不接受 manual/free */
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
 * 对账页唯一一套查询条件：渠道 + 服务商实例 + 账单日 + 状态。
 *
 * 渠道与账单日同时是「执行对账」的入参 —— 页面上不再另起一套执行区，避免
 * 同一屏出现两个渠道下拉、两个日期控件且口径可能不一致。
 */
export type ReconciliationFilterValues = {
  providerId?: string;
  /** 渠道下的具体实例；执行对账与导入必须精确到实例 */
  providerInstanceId?: string;
  status?: string;
  /** 单日账单，空串表示不按账单日过滤（此时也不能执行对账） */
  billDate: string;
};

export type ReconciliationFilterKey = keyof ReconciliationFilterValues;

/** 重置后的空条件。 */
export const EMPTY_RECONCILIATION_FILTERS: ReconciliationFilterValues = {
  providerId: undefined,
  providerInstanceId: undefined,
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

/** 问题类型 → 中文；后端新增类型时前端自动回落原值，不阻塞展示。 */
export const PAYMENT_EXCEPTION_KIND_LABELS: Record<string, string> = {
  cancelled_but_paid: '已取消仍扣款',
  refund_failed: '退款失败',
  refund_processing: '退款异步处理中',
  auto_reconcile_failed: '自动核对失败',
  local_order_not_found: '本地订单缺失',
  provider_record_missing: '收款流水缺失',
  amount_mismatch: '金额不一致',
  trade_no_mismatch: '交易号不一致',
  duplicate_charge: '疑似重复扣款',
  credit_failed: '自动补单失败',
};

export const PAYMENT_EXCEPTION_PRIORITY_OPTIONS = [
  { value: 'urgent', label: '紧急' },
  { value: 'normal', label: '普通' },
];

export const PAYMENT_EXCEPTION_OVERDUE_OPTIONS = [
  { value: 'true', label: '仅看逾期' },
  { value: 'false', label: '全部处理时限' },
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


