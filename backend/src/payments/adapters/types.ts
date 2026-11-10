/**
 * 支付适配器契约（2026-11 支付重构）。
 *
 * 与旧 `PaymentProvider` 的差别：
 *   1. **凭据来自数据库配置**，适配器只能读 `PaymentContext.values`，不得读 env；
 *   2. 新增 `queryOrder / closeOrder / downloadTradeBill`，让查单、关单、对账走同一实现；
 *   3. `verifyNotification` 返回归一化结果，不再由编排层理解各渠道报文差异。
 *
 * 状态口径：`failed` 表示「渠道明确报错或网络失败」，`not_found` 表示
 * 「渠道确认查无此单」。两者不可混用 —— 只有 `not_found` 才允许本地关单。
 */

export type PaymentProviderId =
  | 'sandbox'
  | 'alipay'
  | 'wechat'
  | 'paypal'
  | 'stripe'
  | 'epay'
  | 'zpay';
export const PAYMENT_PROVIDER_IDS: PaymentProviderId[] = [
  'sandbox',
  'alipay',
  'wechat',
  'paypal',
  'stripe',
  'epay',
  'zpay',
];

export type PaymentCurrency = 'CNY' | 'USD';
export const PAYMENT_CURRENCIES: PaymentCurrency[] = ['CNY', 'USD'];

/** C 端固定展示的两种支付方式，与真实渠道解耦。 */
export type VisiblePaymentMethod = 'alipay' | 'wechat';
export const VISIBLE_PAYMENT_METHODS: VisiblePaymentMethod[] = ['alipay', 'wechat'];

export function isVisiblePaymentMethod(value: unknown): value is VisiblePaymentMethod {
  return value === 'alipay' || value === 'wechat';
}

/** 管理员为每个可见支付方式选择的唯一来源。 */
export type PaymentSource = 'unset' | 'official' | 'epay';
export const PAYMENT_SOURCES: PaymentSource[] = ['unset', 'official', 'epay'];

/**
 * `qrcode` 由前端把 `codeUrl` 渲染成二维码；
 * `qrcode-image` 的 `codeUrl` 本身就是渠道给好的二维码图片地址，前端直接展示。
 */
export type CheckoutMode =
  | 'redirect'
  | 'qrcode'
  | 'qrcode-image'
  | 'payment-element'
  | 'sandbox';

export interface PaymentConfigField {
  name: string;
  label: string;
  type: 'text' | 'password' | 'textarea' | 'url' | 'select';
  required: boolean;
  secret?: boolean;
  default?: string;
  options?: Array<{ value: string; label: string }>;
  description?: string;
  /** 已有订单后禁止变更（appId / mchId / sellerId 等） */
  identity?: boolean;
  maxLength?: number;
}

export interface PaymentAdapterDescriptor {
  id: PaymentProviderId;
  name: string;
  icon: string;
  checkoutMode: CheckoutMode;
  configFields: PaymentConfigField[];
  supportedCurrencies: PaymentCurrency[];
  supportsReconciliation: boolean;
}

export interface PaymentContext {
  providerId: PaymentProviderId;
  configId: string;
  configVersion: number;
  /** 本次尝试对应的 C 端支付方式；EasyPay 按此动态选择 type。 */
  paymentMethod?: VisiblePaymentMethod;
  /** 已解密的配置；适配器不得读取 env */
  values: Readonly<Record<string, string>>;
}

export interface CreateOrderInput {
  config: PaymentContext;
  orderId: string;
  orderNo: string;
  amountCents: number;
  currency: PaymentCurrency;
  subject: string;
  returnUrl: string;
  notifyUrl: string;
  /** 服务端从 req.ip 提取的用户 IP；禁止使用前端自报值 */
  clientIp?: string;
  /** 服务端从请求头提取的 User-Agent，用于渠道判定设备类型 */
  clientUserAgent?: string;
  /** 仅支付宝官方：移动端是否调用当面付并返回 App 唤起 Scheme */
  alipayMobilePrecreateDeepLink?: boolean;
  expiresAt: Date;
}

export interface PaymentCheckout {
  mode: CheckoutMode;
  payUrl?: string;
  codeUrl?: string;
  /** 支付宝移动端当面付 App Scheme；其他渠道/场景为空 */
  schemeUrl?: string;
  /** Stripe Payment Element 初始化所需的 client secret 与可公开密钥 */
  clientSecret?: string;
  publishableKey?: string;
  providerRef?: string;
  expiresAt: Date;
  hint?: string;
}

export interface QueryOrderInput {
  config: PaymentContext;
  orderNo: string;
  providerTradeNo?: string;
  /** 渠道侧下单返回的单据 id（PayPal order id / Stripe Checkout Session id 等） */
  providerRef?: string;
}

export interface CloseOrderInput extends QueryOrderInput {}

export type ProviderPaymentState = 'paid' | 'pending' | 'closed' | 'not_found' | 'failed';

export interface ProviderPaymentResult {
  state: ProviderPaymentState;
  orderNo: string;
  tradeNo?: string;
  amountCents?: number;
  currency?: PaymentCurrency;
  paidAt?: Date;
  providerStatus?: string;
  error?: string;
  /** 渠道原始响应；只落库，不进接口响应 */
  rawPayload: string;
}

export interface NotificationInput {
  config: PaymentContext;
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
  body: Record<string, unknown>;
  /** 该笔历史支付尝试固化的支付方式，用于渠道回调验签。 */
  expectedPaymentMethod?: VisiblePaymentMethod;
}

export type NotificationResult =
  | {
      ok: true;
      eventId: string;
      merchantOrderNo: string;
      providerTradeNo: string;
      /** 渠道侧下单单据 id（PayPal order id / Stripe Checkout Session id 等） */
      providerRef?: string;
      amountCents: number;
      currency: PaymentCurrency;
      state: 'paid' | 'closed' | 'pending' | 'failed';
      paidAt?: Date;
      providerStatus: string;
      ackSuccess: boolean;
      reason?: string;
      rawPayload: string;
    }
  | {
      ok: false;
      ackSuccess: false;
      reason: string;
      rawPayload: string;
    };

export interface BillRecord {
  merchantOrderNo: string;
  providerTradeNo: string;
  amountCents: number;
  currency: PaymentCurrency;
  paidAt: Date;
  providerStatus: string;
}

export interface RefundInput {
  config: PaymentContext;
  orderNo: string;
  outRefundNo: string;
  amountCents: number;
  totalCents: number;
  reason?: string;
  /** 渠道侧下单返回的单据 id；部分渠道退款必须先据此反查支付流水 */
  providerRef?: string;
  /** 渠道侧支付流水号（PayPal capture id / Stripe PaymentIntent id 等） */
  providerTradeNo?: string;
}

/**
 * 退款失败的资金语义。
 *
 * - `definitive`：渠道已明确拒绝，本次未退款；修正后可换新退款单号重试。
 * - `unknown`：网络中断、超时、响应无法验签/解析等，**不能确认渠道是否受理**；
 *   必须复用原退款单号重试或到商户后台核对，禁止直接换号发起第二笔退款。
 */
export type RefundFailureKind = 'definitive' | 'unknown';

export type RefundResult =
  | {
      state: 'succeeded';
      providerRefundId?: string;
      raw?: string;
    }
  | {
      state: 'processing';
      providerRefundId?: string;
      raw?: string;
    }
  | {
      state: 'failed';
      failureKind: RefundFailureKind;
      providerRefundId?: string;
      error: string;
      raw?: string;
    };

export interface PaymentAck {
  status: number;
  body: string;
  contentType: string;
}

export interface PaymentAdapter {
  readonly descriptor: PaymentAdapterDescriptor;
  /** 返回缺失/非法的字段名；空数组表示可用 */
  validateConfig(values: Record<string, string>): string[];
  createOrder(input: CreateOrderInput): Promise<PaymentCheckout>;
  queryOrder(input: QueryOrderInput): Promise<ProviderPaymentResult>;
  closeOrder(input: CloseOrderInput): Promise<ProviderPaymentResult>;
  verifyNotification(input: NotificationInput): Promise<NotificationResult>;
  ack(result: NotificationResult): PaymentAck;
  refund(input: RefundInput): Promise<RefundResult>;
  downloadTradeBill?(config: PaymentContext, billDate: string): Promise<BillRecord[]>;
}

/** 元 / 分转换（金额边界唯一入口，禁止散落的 /100） */
export function centsToYuan(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

export function yuanToCents(yuan: string | number): number {
  const n = typeof yuan === 'number' ? yuan : Number.parseFloat(String(yuan));
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.round(n * 100);
}

/** PEM 归一化：环境变量/后台粘贴常把换行写成字面 `\n` */
export function normalizePem(raw: string | undefined): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

/**
 * 渠道回调公网地址校验。
 *
 * 生产必须是 HTTPS；开发/测试允许 http://localhost / 127.0.0.1，方便本机联调。
 * 不限制具体域名 —— 这是商户自己的回调域名，平台不替它做白名单。
 */
export function isAllowedPublicBase(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return true;
    if (process.env.NODE_ENV === 'production') return false;
    return (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}
