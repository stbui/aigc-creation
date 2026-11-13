import type { AdminSettings } from '../../../types/api';

/** 支付规则页只使用设置接口返回的单项结构，不复制后端字段类型。 */
export type PaymentRuleItem = AdminSettings['groups'][number]['items'][number];

export const PAYMENT_RULES_ROUTE = '/admin/payment-rules';
export const PAYMENT_RULES_ANCHOR = 'payment-rules';
export const REFUND_RULES_ANCHOR = 'refund-rules';
export const PAYMENT_CONFIG_HREF = '/admin/payments';

/**
 * 支付渠道来源由 `/admin/payments` 的「客户可选支付方式」统一维护。
 * 本页不渲染这两个键，保存时也会过滤掉，避免两个入口写入同一配置。
 */
export const PAYMENT_RULES_KEYS = {
  enabled: 'payment.enabled',
  defaultCurrency: 'payment.defaultCurrency',
  productNamePrefix: 'payment.productNamePrefix',
  productNameSuffix: 'payment.productNameSuffix',
  minAmountYuan: 'payment.minAmountYuan',
  maxAmountYuan: 'payment.maxAmountYuan',
  dailyLimitYuan: 'payment.dailyLimitYuan',
  helpImage: 'payment.helpImage',
  helpText: 'payment.helpText',
  orderTtlMinutes: 'payment.orderTtlMinutes',
  maxPendingOrders: 'payment.maxPendingOrders',
  cancelLimitEnabled: 'payment.cancelLimitEnabled',
  cancelWindowMode: 'payment.cancelWindowMode',
  cancelWindowSize: 'payment.cancelWindowSize',
  cancelWindowUnit: 'payment.cancelWindowUnit',
  cancelLimitMax: 'payment.cancelLimitMax',
  loadBalancingStrategy: 'payment.loadBalancingStrategy',
  alipayMobilePrecreateDeepLink: 'payment.alipayMobilePrecreateDeepLink',
  refundWindowDays: 'refund.windowDays',
  refundMaxRatioBps: 'refund.maxRatioBps',
  refundAllowConsumedTask: 'refund.allowConsumedTask',
} as const;

export const PAYMENT_RULE_KEYS = new Set<string>(Object.values(PAYMENT_RULES_KEYS));

export const CUSTOMER_EXPERIENCE_KEYS = [
  PAYMENT_RULES_KEYS.enabled,
  PAYMENT_RULES_KEYS.defaultCurrency,
  PAYMENT_RULES_KEYS.productNamePrefix,
  PAYMENT_RULES_KEYS.productNameSuffix,
  PAYMENT_RULES_KEYS.minAmountYuan,
  PAYMENT_RULES_KEYS.maxAmountYuan,
  PAYMENT_RULES_KEYS.dailyLimitYuan,
  PAYMENT_RULES_KEYS.helpImage,
  PAYMENT_RULES_KEYS.helpText,
];

export const ORDER_LIMIT_KEYS = [
  PAYMENT_RULES_KEYS.orderTtlMinutes,
  PAYMENT_RULES_KEYS.maxPendingOrders,
  PAYMENT_RULES_KEYS.cancelLimitEnabled,
  PAYMENT_RULES_KEYS.cancelWindowMode,
  PAYMENT_RULES_KEYS.cancelWindowSize,
  PAYMENT_RULES_KEYS.cancelWindowUnit,
  PAYMENT_RULES_KEYS.cancelLimitMax,
];

export const PAYMENT_STRATEGY_KEYS = [
  PAYMENT_RULES_KEYS.loadBalancingStrategy,
  PAYMENT_RULES_KEYS.alipayMobilePrecreateDeepLink,
];

export const REFUND_RULE_KEYS = [
  PAYMENT_RULES_KEYS.refundWindowDays,
  PAYMENT_RULES_KEYS.refundMaxRatioBps,
  PAYMENT_RULES_KEYS.refundAllowConsumedTask,
];

/** 运营视角文案；技术范围与枚举仍由设置接口给出。 */
export const PAYMENT_RULE_COPY: Record<string, { label: string; hint: string }> = {
  [PAYMENT_RULES_KEYS.enabled]: {
    label: '开放客户支付',
    hint: '关闭后客户侧不再展示支付方式，也无法发起付款；0 元权益领取不受影响。',
  },
  [PAYMENT_RULES_KEYS.defaultCurrency]: {
    label: '默认结算币种',
    hint: '新建充值商品和客户首次打开支付面板时使用，不会改写历史商品价格。',
  },
  [PAYMENT_RULES_KEYS.productNamePrefix]: {
    label: '商品名称前缀',
    hint: '展示在支付页商品名前，可使用品牌名；留空表示不添加。',
  },
  [PAYMENT_RULES_KEYS.productNameSuffix]: {
    label: '商品名称后缀',
    hint: '展示在支付页商品名后，例如“充值”；留空表示不添加。',
  },
  [PAYMENT_RULES_KEYS.minAmountYuan]: {
    label: '最低单笔充值',
    hint: '客户每次充值的最低实付金额，按人民币元填写。',
  },
  [PAYMENT_RULES_KEYS.maxAmountYuan]: {
    label: '最高单笔充值',
    hint: '客户每次充值的最高实付金额；留空表示不限制。',
  },
  [PAYMENT_RULES_KEYS.dailyLimitYuan]: {
    label: '每客户每日充值上限',
    hint: '已支付和待支付订单都会占用当日额度；留空表示不限制。',
  },
  [PAYMENT_RULES_KEYS.helpImage]: {
    label: '支付帮助图片',
    hint: '可放客服二维码或充值说明，客户会在充值页看到；留空表示不展示。',
  },
  [PAYMENT_RULES_KEYS.helpText]: {
    label: '支付帮助说明',
    hint: '补充到账时间、客服方式或退款说明；留空表示不展示。',
  },
  [PAYMENT_RULES_KEYS.orderTtlMinutes]: {
    label: '待支付订单保留时长',
    hint: '超时后系统自动关闭订单，避免长期占用待支付名额。',
  },
  [PAYMENT_RULES_KEYS.maxPendingOrders]: {
    label: '同时待支付订单上限',
    hint: '每位客户最多保留的未付款订单数，达到上限后不能继续创建。',
  },
  [PAYMENT_RULES_KEYS.cancelLimitEnabled]: {
    label: '限制客户频繁取消',
    hint: '开启后，客户主动取消待支付订单会占用统计周期内的取消次数；超时关单不计入。',
  },
  [PAYMENT_RULES_KEYS.cancelWindowMode]: {
    label: '取消次数统计方式',
    hint: '滚动统计按最近一段时间计算；固定统计按自然周期重置。',
  },
  [PAYMENT_RULES_KEYS.cancelWindowSize]: {
    label: '取消统计周期',
    hint: '与下一项单位组合成完整周期，例如 10 分钟或 1 小时。',
  },
  [PAYMENT_RULES_KEYS.cancelWindowUnit]: {
    label: '取消周期单位',
    hint: '选择按分钟或小时统计客户主动取消次数。',
  },
  [PAYMENT_RULES_KEYS.cancelLimitMax]: {
    label: '周期内最多取消',
    hint: '客户在一个统计周期内允许主动取消的订单数，超过后需等待下一周期。',
  },
  [PAYMENT_RULES_KEYS.loadBalancingStrategy]: {
    label: '收款通道分配方式',
    hint: '多个可用收款通道之间如何分流，影响客户付款体验与渠道压力。',
  },
  [PAYMENT_RULES_KEYS.alipayMobilePrecreateDeepLink]: {
    label: '支付宝 App 直接唤起',
    hint: '仅对支付宝官方移动端订单生效；唤起失败时仍会展示二维码备用页。',
  },
  [PAYMENT_RULES_KEYS.refundWindowDays]: {
    label: '可申请退款时间窗',
    hint: '支付成功后多少天内允许退款；0 表示不限时间，但仍受可退比例与积分规则约束。',
  },
  [PAYMENT_RULES_KEYS.refundMaxRatioBps]: {
    label: '单笔最高可退比例',
    hint: '按实付金额计算，页面以百分比展示；100% 表示可全额退款。',
  },
  [PAYMENT_RULES_KEYS.refundAllowConsumedTask]: {
    label: '积分已使用时仍可退款',
    hint: '关闭后，只要订单积分已被消耗且无法全额扣回，就会拒绝退款。',
  },
};

export const PAYMENT_RULE_GROUP_KEYS = new Set(['payment', 'refund']);

/** 把设置接口返回的支付/退款项收敛为当前页面可编辑的范围。 */
export function paymentRuleItems(settings: AdminSettings): PaymentRuleItem[] {
  return settings.groups
    .filter((group) => PAYMENT_RULE_GROUP_KEYS.has(group.key))
    .flatMap((group) => group.items)
    .filter((item) => PAYMENT_RULE_KEYS.has(item.key));
}

export function refundRatioPercent(value: unknown): number {
  const bps = Number(value);
  return Number.isFinite(bps) ? Math.max(0, Math.min(100, bps / 100)) : 0;
}
