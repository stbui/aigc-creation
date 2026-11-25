import type {
  CheckoutPaymentMethod,
  PaymentAdapter,
  PaymentContext,
  PaymentProviderId,
} from './adapters/types';

export type PaymentActor =
  | { kind: 'user'; userId: string }
  | { kind: 'admin'; adminId: string }
  | { kind: 'worker' };

/**
 * 一次可查询/可关单的渠道尝试。
 *
 * 不能只看 `Order.channel`：同一订单可能先后发起过支付宝和微信两次支付，
 * 订单上的渠道是**最后一次**发起，而用户可能支付的是更早那次。
 * 回调、查单、关单都必须逐个尝试核对，否则会漏掉已收款的旧尝试。
 */
export interface AttemptContext {
  /** 对应 Payment 行；历史单可能没有，为 null */
  paymentId: string | null;
  providerId: PaymentProviderId;
  providerInstanceId: string;
  /** 渠道侧下单返回的单据 id（PayPal order id / Stripe Checkout Session id 等） */
  providerRef?: string;
  /** 渠道侧支付流水号（PayPal capture id / Stripe PaymentIntent id 等） */
  providerTradeNo?: string;
  config: PaymentContext;
  adapter: PaymentAdapter;
}

/** 支付编排租约的所有权凭证；写回 lastError / 释放租约时必须带上。 */
export interface PaymentLease {
  closeLeaseAt?: Date;
  intentLeaseAt?: Date;
}

export interface PaymentIntentView {
  orderId: string;
  orderNo: string;
  amountCents: number;
  currency: string;
  providerId: CheckoutPaymentMethod | 'free';
  configId: string | null;
  configVersion: number | null;
  mode: string;
  payUrl?: string;
  codeUrl?: string;
  schemeUrl?: string;
  clientSecret?: string;
  publishableKey?: string;
  returnUrl?: string;
  checkoutValue: string | null;
  expiresAt: string;
  sandbox: boolean;
  hint?: string | null;
}

export interface PaymentOrderView {
  orderId: string;
  orderNo: string;
  status: string;
  displayStatus: string;
  amountCents: number;
  currency: string;
  /** C 端只暴露支付宝 / 微信 / 沙箱（仅开发测试）/ 免费单；真实渠道（如 epay）永不外泄。 */
  providerId: CheckoutPaymentMethod | 'free' | 'unknown';
  checkoutMode: string | null;
  checkoutValue: string | null;
  expiresAt: string;
  providerPaidAt: string | null;
  creditedAt: string | null;
  closedAt: string | null;
  lastError: string | null;
  payments: Array<{
    id: string;
    status: string;
    providerId: CheckoutPaymentMethod | 'free' | 'unknown';
    providerRef: string | null;
    providerTradeNo: string | null;
    amountCents: number;
    createdAt: string;
  }>;
}
