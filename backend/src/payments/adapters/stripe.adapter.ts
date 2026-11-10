import { Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  CloseOrderInput,
  CreateOrderInput,
  NotificationInput,
  NotificationResult,
  PaymentAck,
  PaymentAdapter,
  PaymentAdapterDescriptor,
  PaymentCheckout,
  PaymentContext,
  PaymentCurrency,
  ProviderPaymentResult,
  QueryOrderInput,
  RefundInput,
  RefundResult,
  isAllowedPublicBase,
} from './types';

const DEFAULT_API_BASE = 'https://api.stripe.com';
const WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Stripe Payment Element 适配器。
 *
 * 新订单创建 PaymentIntent，由前端 Payment Element 收集支付信息并确认；
 * 服务端不接触卡号等敏感信息。历史 Checkout Session 仍可查单、关单、退款，
 * 确保切换前创建的订单能够正常闭环。
 */
export class StripeAdapter implements PaymentAdapter {
  private readonly logger = new Logger(StripeAdapter.name);

  readonly descriptor: PaymentAdapterDescriptor = {
    id: 'stripe',
    name: 'Stripe',
    icon: 'stripe',
    checkoutMode: 'payment-element',
    supportedCurrencies: ['CNY', 'USD'],
    supportsReconciliation: false,
    configFields: [
      {
        name: 'secretKey',
        label: 'Secret Key',
        type: 'password',
        required: true,
        secret: true,
        maxLength: 512,
        description: 'Stripe Secret Key（sk_live_... 或 sk_test_...）',
      },
      {
        name: 'publishableKey',
        label: 'Publishable Key',
        type: 'text',
        required: true,
        maxLength: 512,
        description: 'Stripe 可公开密钥（pk_live_... 或 pk_test_...）',
      },
      {
        name: 'webhookSecret',
        label: 'Webhook Secret',
        type: 'password',
        required: true,
        secret: true,
        maxLength: 256,
        description: 'Stripe Webhook Endpoint 的 whsec_... 签名密钥',
      },
      {
        name: 'apiBase',
        label: 'API 地址',
        type: 'url',
        required: false,
        default: DEFAULT_API_BASE,
        description: '固定使用 https://api.stripe.com；测试模式由 sk_test_ 密钥决定',
      },
      {
        name: 'publicBaseUrl',
        label: '回调公网地址（可选）',
        type: 'url',
        required: false,
        default: '',
        description: '例如 https://pay.example.com；留空使用 PAYMENT_NOTIFY_BASE',
      },
    ],
  };

  validateConfig(values: Record<string, string>): string[] {
    const invalid: string[] = [];
    if (!values.secretKey?.trim()) invalid.push('secretKey');
    if (!values.publishableKey?.trim()) invalid.push('publishableKey');
    if (!values.webhookSecret?.trim()) invalid.push('webhookSecret');
    const apiBase = values.apiBase?.trim();
    if (apiBase && apiBase.replace(/\/$/, '') !== DEFAULT_API_BASE) invalid.push('apiBase');
    const publicBaseUrl = values.publicBaseUrl?.trim();
    if (publicBaseUrl && !isAllowedPublicBase(publicBaseUrl)) invalid.push('publicBaseUrl');
    return Array.from(new Set(invalid));
  }

  async createOrder(input: CreateOrderInput): Promise<PaymentCheckout> {
    const params = new URLSearchParams();
    params.set('amount', String(input.amountCents));
    params.set('currency', input.currency.toLowerCase());
    params.set('metadata[orderNo]', input.orderNo);
    params.set('automatic_payment_methods[enabled]', 'true');

    const paymentIntent = await this.request(
      input.config,
      'POST',
      '/v1/payment_intents',
      params,
    );
    const id = asString(paymentIntent.id);
    const clientSecret = asString(paymentIntent.client_secret);
    const publishableKey = input.config.values.publishableKey?.trim();
    if (!id) throw new Error('Stripe 下单未返回 PaymentIntent id');
    if (!clientSecret) throw new Error('Stripe 下单未返回 client secret');
    if (!publishableKey) throw new Error('Stripe Publishable Key 未配置');

    return {
      mode: 'payment-element',
      clientSecret,
      publishableKey,
      providerRef: id,
      expiresAt: input.expiresAt,
      hint: '请使用 Stripe Payment Element 完成支付；Webhook 需订阅 payment_intent.* 事件。',
    };
  }

  async queryOrder(input: QueryOrderInput): Promise<ProviderPaymentResult> {
    const providerRef = input.providerRef?.trim();
    if (!providerRef) {
      return failed(input.orderNo, '缺少 Stripe PaymentIntent id，无法查单；请重新发起支付');
    }

    try {
      if (isPaymentIntentId(providerRef)) {
        const paymentIntent = await this.request(
          input.config,
          'GET',
          `/v1/payment_intents/${encodeURIComponent(providerRef)}`,
        );
        return mapPaymentIntent(input.orderNo, paymentIntent);
      }
      const params = new URLSearchParams();
      params.append('expand[]', 'payment_intent');
      const session = await this.request(
        input.config,
        'GET',
        `/v1/checkout/sessions/${encodeURIComponent(providerRef)}`,
        params,
      );
      return mapSession(input.orderNo, session);
    } catch (e) {
      return failed(input.orderNo, `Stripe 查单失败: ${(e as Error).message}`);
    }
  }

  async closeOrder(input: CloseOrderInput): Promise<ProviderPaymentResult> {
    const providerRef = input.providerRef?.trim();
    if (!providerRef) {
      return failed(input.orderNo, '缺少 Stripe PaymentIntent id，无法关闭');
    }

    try {
      if (isPaymentIntentId(providerRef)) {
        const paymentIntent = await this.request(
          input.config,
          'POST',
          `/v1/payment_intents/${encodeURIComponent(providerRef)}/cancel`,
        );
        return mapPaymentIntent(input.orderNo, paymentIntent);
      }
      const session = await this.request(
        input.config,
        'POST',
        `/v1/checkout/sessions/${encodeURIComponent(providerRef)}/expire`,
      );
      return mapSession(input.orderNo, session);
    } catch (e) {
      return failed(input.orderNo, `Stripe 关闭 Checkout Session 失败: ${(e as Error).message}`);
    }
  }

  async verifyNotification(input: NotificationInput): Promise<NotificationResult> {
    const raw = input.rawBody.toString('utf8');
    const secret = input.config.values.webhookSecret?.trim();
    if (!secret) {
      return { ok: false, ackSuccess: false, reason: 'Stripe Webhook Secret 未配置', rawPayload: raw };
    }
    const signature = header(input.headers, 'stripe-signature');
    if (!signature || !verifyStripeSignature(input.rawBody, signature, secret)) {
      return { ok: false, ackSuccess: false, reason: 'Stripe Webhook 验签失败', rawPayload: raw };
    }

    const event = input.body as Record<string, unknown>;
    const eventType = asString(event.type);
    const eventId = asString(event.id) || `stripe:${hash(raw)}`;
    const data = asObject(event.data);
    const object = asObject(data?.object);
    if (!object) {
      return { ok: false, ackSuccess: false, reason: 'Stripe 事件缺少数据对象', rawPayload: raw };
    }

    if (eventType.startsWith('payment_intent.')) {
      return this.verifyPaymentIntentNotification(event, eventType, eventId, object, raw);
    }

    const merchantOrderNo =
      asString(object.client_reference_id) ||
      asString(asObject(object.metadata)?.orderNo);
    const providerRef = asString(object.id);
    const providerTradeNo = paymentIntentId(object.payment_intent) || providerRef;
    const amountCents = numberOrUndefined(object.amount_total);
    const currency = currencyOf(object.currency);
    const providerStatus = `${eventType}:${asString(object.payment_status) || asString(object.status)}`;

    if (!merchantOrderNo) {
      return { ok: false, ackSuccess: false, reason: 'Stripe 回调缺少商户订单号', rawPayload: raw };
    }

    if (eventType === 'checkout.session.completed' || eventType === 'checkout.session.async_payment_succeeded') {
      const paymentStatus = asString(object.payment_status);
      const paid = paymentStatus === 'paid' || paymentStatus === 'no_payment_required';
      if (paid) {
        if (!providerTradeNo || amountCents === undefined || !currency) {
          return { ok: false, ackSuccess: false, reason: 'Stripe 支付回调字段不完整', rawPayload: raw };
        }
        return {
          ok: true,
          eventId,
          merchantOrderNo,
          providerTradeNo,
          providerRef,
          amountCents,
          currency,
          state: 'paid',
          paidAt: eventCreatedAt(event),
          providerStatus,
          ackSuccess: true,
          rawPayload: raw,
        };
      }

      // Checkout 完成不等于钱已到账。异步支付方式可能稍后才成功。
      return {
        ok: true,
        eventId,
        merchantOrderNo,
        providerTradeNo,
        providerRef,
        amountCents: amountCents ?? 0,
        currency: currency ?? 'CNY',
        state: 'pending',
        providerStatus,
        ackSuccess: true,
        reason: 'Stripe Checkout 已完成，等待异步支付结果',
        rawPayload: raw,
      };
    }

    if (eventType === 'checkout.session.async_payment_failed') {
      return {
        ok: true,
        eventId,
        merchantOrderNo,
        providerTradeNo,
        providerRef,
        amountCents: amountCents ?? 0,
        currency: currency ?? 'CNY',
        state: 'failed',
        providerStatus,
        ackSuccess: true,
        reason: 'Stripe 异步支付失败',
        rawPayload: raw,
      };
    }

    if (eventType === 'checkout.session.expired') {
      return {
        ok: true,
        eventId,
        merchantOrderNo,
        providerTradeNo,
        providerRef,
        amountCents: amountCents ?? 0,
        currency: currency ?? 'CNY',
        state: 'closed',
        providerStatus,
        ackSuccess: true,
        reason: 'Stripe Checkout Session 已过期',
        rawPayload: raw,
      };
    }

    return {
      ok: false,
      ackSuccess: false,
      reason: `Stripe 事件未处理: ${eventType || 'unknown'}`,
      rawPayload: raw,
    };
  }

  ack(result: NotificationResult): PaymentAck {
    const accepted = result.ok ? result.ackSuccess : false;
    return {
      status: accepted ? 200 : 400,
      body: accepted ? 'ok' : (result.ok ? result.reason : result.reason).slice(0, 200),
      contentType: 'text/plain; charset=utf-8',
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    try {
      let paymentIntent = input.providerTradeNo?.trim() || '';
      if (!paymentIntent && input.providerRef?.trim()) {
        const providerRef = input.providerRef.trim();
        if (isPaymentIntentId(providerRef)) {
          paymentIntent = providerRef;
        } else if (providerRef.startsWith('cs_')) {
          const params = new URLSearchParams();
          params.append('expand[]', 'payment_intent');
          const session = await this.request(
            input.config,
            'GET',
            `/v1/checkout/sessions/${encodeURIComponent(providerRef)}`,
            params,
          );
          paymentIntent = paymentIntentId(session.payment_intent);
        }
      }
      if (!paymentIntent) {
        return {
          state: 'failed',
          failureKind: 'definitive',
          error: '缺少 Stripe PaymentIntent id，无法退款',
        };
      }

      const params = new URLSearchParams();
      params.set('payment_intent', paymentIntent);
      params.set('amount', String(input.amountCents));
      params.set('metadata[refundNo]', input.outRefundNo);
      if (input.reason) params.set('metadata[reason]', input.reason.slice(0, 500));

      const result = await this.request(input.config, 'POST', '/v1/refunds', params, input.outRefundNo);
      const id = asString(result.id);
      const status = asString(result.status);
      if (status === 'succeeded') return { state: 'succeeded', providerRefundId: id, raw: safeJson(result) };
      if (status === 'pending' || status === 'requires_action') {
        return { state: 'processing', providerRefundId: id, raw: safeJson(result) };
      }
      return {
        state: 'failed',
        failureKind: status === 'failed' || status === 'canceled' ? 'definitive' : 'unknown',
        providerRefundId: id,
        error: `Stripe 退款状态: ${status || 'unknown'}`,
        raw: safeJson(result),
      };
    } catch (e) {
      return {
        state: 'failed',
        failureKind: 'unknown',
        error: `Stripe 退款失败: ${(e as Error).message}`,
      };
    }
  }

  private verifyPaymentIntentNotification(
    event: Record<string, unknown>,
    eventType: string,
    eventId: string,
    paymentIntent: Record<string, unknown>,
    raw: string,
  ): NotificationResult {
    const merchantOrderNo = asString(asObject(paymentIntent.metadata)?.orderNo);
    const providerRef = asString(paymentIntent.id);
    const amountCents =
      numberOrUndefined(paymentIntent.amount_received) ??
      numberOrUndefined(paymentIntent.amount);
    const currency = currencyOf(paymentIntent.currency);
    const status = asString(paymentIntent.status);
    const providerStatus = `${eventType}:${status}`;

    if (!merchantOrderNo) {
      return { ok: false, ackSuccess: false, reason: 'Stripe 回调缺少商户订单号', rawPayload: raw };
    }
    if (!providerRef) {
      return { ok: false, ackSuccess: false, reason: 'Stripe 回调缺少 PaymentIntent id', rawPayload: raw };
    }

    if (eventType === 'payment_intent.succeeded' || status === 'succeeded') {
      if (amountCents === undefined || !currency) {
        return { ok: false, ackSuccess: false, reason: 'Stripe 支付回调字段不完整', rawPayload: raw };
      }
      return {
        ok: true,
        eventId,
        merchantOrderNo,
        providerTradeNo: providerRef,
        providerRef,
        amountCents,
        currency,
        state: 'paid',
        paidAt: eventCreatedAt(event),
        providerStatus,
        ackSuccess: true,
        rawPayload: raw,
      };
    }

    if (eventType === 'payment_intent.payment_failed' || status === 'requires_payment_method') {
      return {
        ok: true,
        eventId,
        merchantOrderNo,
        providerTradeNo: providerRef,
        providerRef,
        amountCents: amountCents ?? 0,
        currency: currency ?? 'CNY',
        state: 'failed',
        providerStatus,
        ackSuccess: true,
        reason: 'Stripe PaymentIntent 支付失败',
        rawPayload: raw,
      };
    }

    if (eventType === 'payment_intent.canceled' || status === 'canceled') {
      return {
        ok: true,
        eventId,
        merchantOrderNo,
        providerTradeNo: providerRef,
        providerRef,
        amountCents: amountCents ?? 0,
        currency: currency ?? 'CNY',
        state: 'closed',
        providerStatus,
        ackSuccess: true,
        reason: 'Stripe PaymentIntent 已取消',
        rawPayload: raw,
      };
    }

    return {
      ok: false,
      ackSuccess: false,
      reason: `Stripe 事件未处理: ${eventType || 'unknown'}`,
      rawPayload: raw,
    };
  }

  private async request(
    config: PaymentContext,
    method: 'GET' | 'POST',
    path: string,
    params?: URLSearchParams,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    const apiBase = (config.values.apiBase?.trim() || DEFAULT_API_BASE).replace(/\/$/, '');
    const query = method === 'GET' && params?.size ? `?${params.toString()}` : '';
    const res = await fetch(`${apiBase}${path}${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.values.secretKey}`,
        Accept: 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey.slice(0, 255) } : {}),
      },
      ...(method === 'POST' ? { body: params?.toString() ?? '' } : {}),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    const json = parseJsonObject(text);
    if (!res.ok) {
      const error = asObject(json?.error);
      const message = asString(error?.message) || asString(json?.message) || `HTTP ${res.status}`;
      this.logger.warn(`Stripe API 失败 (${method} ${path}): ${message}`);
      throw new Error(message);
    }
    if (!json) throw new Error('Stripe 响应不是合法 JSON');
    return json;
  }
}

export function verifyStripeSignature(
  rawBody: Buffer | string,
  signatureHeader: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const pairs = signatureHeader.split(',').map((part) => part.trim()).filter(Boolean);
  let timestamp = '';
  const signatures: string[] = [];
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const key = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (key === 't') timestamp = value;
    if (key === 'v1') signatures.push(value);
  }
  if (!/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8'))
    .digest();
  return signatures.some((signature) => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const actual = Buffer.from(signature, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

function mapSession(orderNo: string, session: Record<string, unknown>): ProviderPaymentResult {
  const raw = safeJson(session);
  const paymentStatus = asString(session.payment_status);
  const sessionStatus = asString(session.status);
  const currency = currencyOf(session.currency);
  const amountCents = numberOrUndefined(session.amount_total);
  const tradeNo = paymentIntentId(session.payment_intent) || undefined;
  const providerStatus = paymentStatus || sessionStatus || 'UNKNOWN';

  if (paymentStatus === 'paid' || paymentStatus === 'no_payment_required') {
    return {
      state: 'paid',
      orderNo,
      tradeNo,
      amountCents,
      currency: currency ?? undefined,
      providerStatus,
      rawPayload: raw,
    };
  }
  if (sessionStatus === 'expired') {
    return { state: 'closed', orderNo, tradeNo, amountCents, currency: currency ?? undefined, providerStatus, rawPayload: raw };
  }
  if (sessionStatus === 'open' || (sessionStatus === 'complete' && paymentStatus === 'unpaid')) {
    return { state: 'pending', orderNo, tradeNo, amountCents, currency: currency ?? undefined, providerStatus, rawPayload: raw };
  }
  return {
    state: 'failed',
    orderNo,
    tradeNo,
    amountCents,
    currency: currency ?? undefined,
    providerStatus,
    error: `Stripe 未知状态: ${sessionStatus || 'unknown'}/${paymentStatus || 'unknown'}`,
    rawPayload: raw,
  };
}

function mapPaymentIntent(
  orderNo: string,
  paymentIntent: Record<string, unknown>,
): ProviderPaymentResult {
  const raw = safeJson(paymentIntent);
  const status = asString(paymentIntent.status);
  const amountCents =
    numberOrUndefined(paymentIntent.amount_received) ??
    numberOrUndefined(paymentIntent.amount);
  const currency = currencyOf(paymentIntent.currency);
  const tradeNo = asString(paymentIntent.id) || undefined;
  const providerStatus = status || 'UNKNOWN';

  if (status === 'succeeded') {
    return {
      state: 'paid',
      orderNo,
      tradeNo,
      amountCents,
      currency: currency ?? undefined,
      providerStatus,
      rawPayload: raw,
    };
  }
  if (status === 'canceled') {
    return {
      state: 'closed',
      orderNo,
      tradeNo,
      amountCents,
      currency: currency ?? undefined,
      providerStatus,
      rawPayload: raw,
    };
  }
  if (
    status === 'requires_payment_method' ||
    status === 'requires_confirmation' ||
    status === 'requires_action' ||
    status === 'processing' ||
    status === 'requires_capture'
  ) {
    return {
      state: 'pending',
      orderNo,
      tradeNo,
      amountCents,
      currency: currency ?? undefined,
      providerStatus,
      rawPayload: raw,
    };
  }
  return {
    state: 'failed',
    orderNo,
    tradeNo,
    amountCents,
    currency: currency ?? undefined,
    providerStatus,
    error: `Stripe 未知状态: ${status || 'unknown'}`,
    rawPayload: raw,
  };
}

function isPaymentIntentId(value: string): boolean {
  return value.startsWith('pi_');
}

function paymentIntentId(value: unknown): string {
  if (typeof value === 'string') return value;
  return asString(asObject(value)?.id);
}

function currencyOf(value: unknown): PaymentCurrency | undefined {
  const code = asString(value).toUpperCase();
  return code === 'CNY' || code === 'USD' ? code : undefined;
}

function eventCreatedAt(event: Record<string, unknown>): Date | undefined {
  const seconds = numberOrUndefined(event.created);
  return seconds ? new Date(seconds * 1000) : undefined;
}

function failed(orderNo: string, error: string): ProviderPaymentResult {
  return { state: 'failed', orderNo, error, providerStatus: 'CLIENT_ERROR', rawPayload: '' };
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? (value[0] ?? '').trim() : String(value ?? '').trim();
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberOrUndefined(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    return asObject(JSON.parse(text));
  } catch {
    return null;
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function hash(value: string): string {
  return createHmac('sha256', 'stripe-event').update(value).digest('hex');
}
