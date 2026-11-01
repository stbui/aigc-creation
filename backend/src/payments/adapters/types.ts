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

export type PaymentProviderId = 'sandbox' | 'alipay' | 'wechat';
export const PAYMENT_PROVIDER_IDS: PaymentProviderId[] = ['sandbox', 'alipay', 'wechat'];

export type PaymentCurrency = 'CNY' | 'USD';
export const PAYMENT_CURRENCIES: PaymentCurrency[] = ['CNY', 'USD'];

export type CheckoutMode = 'redirect' | 'qrcode' | 'sandbox';

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
  expiresAt: Date;
}

export interface PaymentCheckout {
  mode: CheckoutMode;
  payUrl?: string;
  codeUrl?: string;
  providerRef?: string;
  expiresAt: Date;
  hint?: string;
}

export interface QueryOrderInput {
  config: PaymentContext;
  orderNo: string;
  providerTradeNo?: string;
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
}

export type NotificationResult =
  | {
      ok: true;
      eventId: string;
      merchantOrderNo: string;
      providerTradeNo: string;
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
}

export interface RefundResult {
  state: 'succeeded' | 'processing' | 'failed';
  providerRefundId?: string;
  error?: string;
  raw?: string;
}

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
