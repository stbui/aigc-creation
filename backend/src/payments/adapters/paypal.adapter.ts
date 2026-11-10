import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
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
  centsToYuan,
  isAllowedPublicBase,
  yuanToCents,
} from './types';

const DEFAULT_API_BASE = 'https://api-m.paypal.com';
const SANDBOX_API_BASE = 'https://api-m.sandbox.paypal.com';

interface PayPalToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * PayPal Orders v2 适配器（Checkout 跳转）。
 *
 * 1. OAuth2 client_credentials 换 access token；
 * 2. 创建 CAPTURE intent 订单，用户到 PayPal 收银台付款；
 * 3. 回调通过 PayPal 官方 verify-webhook-signature 接口验签，不在进程内信任
 *    任意 cert URL —— 该 URL 来自请求头，自行下载会给攻击者一个 SSRF/伪造证书入口；
 * 4. 查单与退款都以渠道返回的 order/capture id 为准，商户订单号只做业务关联。
 */
export class PaypalAdapter implements PaymentAdapter {
  private readonly logger = new Logger(PaypalAdapter.name);
  private readonly tokenCache = new Map<string, PayPalToken>();

  readonly descriptor: PaymentAdapterDescriptor = {
    id: 'paypal',
    name: 'PayPal',
    icon: 'paypal',
    checkoutMode: 'redirect',
    supportedCurrencies: ['CNY', 'USD'],
    supportsReconciliation: false,
    configFields: [
      {
        name: 'clientId',
        label: 'Client ID',
        type: 'text',
        required: true,
        identity: true,
        maxLength: 256,
        description: 'PayPal REST App 的 Client ID',
      },
      {
        name: 'clientSecret',
        label: 'Client Secret',
        type: 'password',
        required: true,
        secret: true,
        maxLength: 512,
      },
      {
        name: 'webhookId',
        label: 'Webhook ID',
        type: 'text',
        required: true,
        maxLength: 128,
        description: 'PayPal 开发者后台创建的 Webhook ID，用于回调验签',
      },
      {
        name: 'apiBase',
        label: 'API 地址',
        type: 'url',
        required: false,
        default: DEFAULT_API_BASE,
        description: `生产 ${DEFAULT_API_BASE}；沙箱 ${SANDBOX_API_BASE}`,
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
    for (const field of this.descriptor.configFields) {
      if (field.required && !values[field.name]?.trim()) invalid.push(field.name);
    }
    const apiBase = values.apiBase?.trim();
    if (apiBase && !isAllowedPayPalApiBase(apiBase)) invalid.push('apiBase');
    const publicBaseUrl = values.publicBaseUrl?.trim();
    if (publicBaseUrl && !isAllowedPublicBase(publicBaseUrl)) invalid.push('publicBaseUrl');
    return Array.from(new Set(invalid));
  }

  async createOrder(input: CreateOrderInput): Promise<PaymentCheckout> {
    const v = input.config.values;
    const result = await this.request(input.config, 'POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: input.orderNo,
          custom_id: input.orderNo,
          invoice_id: input.orderNo,
          description: input.subject.slice(0, 127),
          amount: {
            currency_code: input.currency,
            value: centsToYuan(input.amountCents),
          },
        },
      ],
      application_context: {
        brand_name: '货觉AI',
        landing_page: 'LOGIN',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
        return_url: input.returnUrl,
        cancel_url: input.returnUrl,
      },
    }, input.orderNo);

    const id = asString(result?.id);
    if (!id) throw new Error('PayPal 下单未返回订单 id');
    const links = asArray(result?.links);
    const approve = links.find((item) => {
      const rel = asString(asObject(item)?.rel);
      return rel === 'approve' || rel === 'payer-action';
    });
    const payUrl = asString(asObject(approve)?.href);
    if (!payUrl) throw new Error('PayPal 下单未返回付款链接');

    return {
      mode: 'redirect',
      payUrl,
      providerRef: id,
      expiresAt: input.expiresAt,
      hint: '请在 PayPal 收银台完成支付；Webhook 需在 PayPal 开发者后台指向本渠道回调地址。',
    };
  }

  async queryOrder(input: QueryOrderInput): Promise<ProviderPaymentResult> {
    const providerRef = input.providerRef?.trim();
    if (!providerRef) {
      return failed(input.orderNo, '缺少 PayPal 订单 id，无法查单；请重新发起支付');
    }

    try {
      let json = await this.request(
        input.config,
        'GET',
        `/v2/checkout/orders/${encodeURIComponent(providerRef)}`,
      );

      /*
       * Orders v2 的 CAPTURE intent 在 payer 批准后只到 APPROVED，必须由服务端
       * 再调用 capture 才会真正扣款。结算页回跳和轮询都会走到这里；固定
       * PayPal-Request-Id 让并发/重试的 capture 请求由 PayPal 幂等去重。
       */
      if (asString(json.status) === 'APPROVED') {
        try {
          json = await this.request(
            input.config,
            'POST',
            `/v2/checkout/orders/${encodeURIComponent(providerRef)}/capture`,
            {},
            `capture:${input.orderNo}`,
          );
        } catch (captureError) {
          // capture 可能已在渠道成功但响应丢失；先重新查单，仍为 APPROVED 才报失败。
          const latest = await this.request(
            input.config,
            'GET',
            `/v2/checkout/orders/${encodeURIComponent(providerRef)}`,
          );
          if (asString(latest.status) === 'APPROVED') {
            return failed(
              input.orderNo,
              `PayPal capture 失败: ${(captureError as Error).message}`,
            );
          }
          json = latest;
        }
      }

      return mapOrder(input.orderNo, json);
    } catch (e) {
      return failed(input.orderNo, `PayPal 查单失败: ${(e as Error).message}`);
    }
  }

  async closeOrder(input: CloseOrderInput): Promise<ProviderPaymentResult> {
    // PayPal Orders v2 没有关闭未授权 Checkout 订单的公开接口。绝不能伪造
    // `closed`：订单随后仍可能被买家支付，本地却已经取消并释放了库存。
    return failed(
      input.orderNo,
      'PayPal 不支持关闭未授权 Checkout 订单；请等待 PayPal 侧订单失效，或查单确认未支付后人工处理',
    );
  }

  async verifyNotification(input: NotificationInput): Promise<NotificationResult> {
    const raw = input.rawBody.toString('utf8');
    const headers = input.headers;
    const transmissionId = header(headers, 'paypal-transmission-id');
    const transmissionTime = header(headers, 'paypal-transmission-time');
    const certUrl = header(headers, 'paypal-cert-url');
    const authAlgo = header(headers, 'paypal-auth-algo');
    const transmissionSig = header(headers, 'paypal-transmission-sig');
    const webhookId = input.config.values.webhookId?.trim();

    if (!webhookId) {
      return { ok: false, ackSuccess: false, reason: 'PayPal Webhook ID 未配置', rawPayload: raw };
    }
    if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
      return { ok: false, ackSuccess: false, reason: 'PayPal 回调缺少验签请求头', rawPayload: raw };
    }

    try {
      const verification = await this.request(input.config, 'POST', '/v1/notifications/verify-webhook-signature', {
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: input.body,
      });
      if (asString(verification?.verification_status) !== 'SUCCESS') {
        return { ok: false, ackSuccess: false, reason: 'PayPal Webhook 验签失败', rawPayload: raw };
      }
    } catch (e) {
      this.logger.error(`PayPal Webhook 验签调用失败: ${(e as Error).message}`);
      return { ok: false, ackSuccess: false, reason: 'PayPal Webhook 验签服务不可用', rawPayload: raw };
    }

    const event = input.body as Record<string, unknown>;
    const eventType = asString(event.event_type);
    const eventId = asString(event.id) || `paypal:${createHash('sha256').update(raw).digest('hex')}`;
    const resource = asObject(event.resource) ?? {};
    const parsed = parsePayPalResource(resource, eventType);
    const providerStatus = eventType || 'UNKNOWN';
    const paidAt = parseDate(asString(resource.create_time) || asString(resource.update_time));

    /*
     * PAYMENT.CAPTURE.* 的 resource 是 capture，通常只在
     * supplementary_data.related_ids.order_id 里带 PayPal Order ID，不带
     * purchase_unit 的 custom_id。验签通过后反查该 Order，才能拿到本地 orderNo；
     * 反查失败时拒绝 ack，让 PayPal 重试，绝不能按「同订单最新 Payment」猜测。
     */
    if (!parsed.orderNo && parsed.providerRef && parsed.kind !== 'ignored') {
      try {
        const order = await this.request(
          input.config,
          'GET',
          `/v2/checkout/orders/${encodeURIComponent(parsed.providerRef)}`,
        );
        parsed.orderNo = orderNoFromOrder(order);
      } catch (e) {
        this.logger.warn(
          `PayPal 回调反查订单失败 (${parsed.providerRef}): ${(e as Error).message}`,
        );
      }
    }

    if (parsed.kind === 'paid') {
      if (!parsed.orderNo || !parsed.tradeNo || !Number.isFinite(parsed.amountCents)) {
        return { ok: false, ackSuccess: false, reason: 'PayPal 支付回调字段不完整', rawPayload: raw };
      }
      return {
        ok: true,
        eventId,
        merchantOrderNo: parsed.orderNo,
        providerTradeNo: parsed.tradeNo,
        providerRef: parsed.providerRef,
        amountCents: parsed.amountCents,
        currency: parsed.currency,
        state: 'paid',
        paidAt,
        providerStatus,
        ackSuccess: true,
        rawPayload: raw,
      };
    }

    if (parsed.kind === 'closed' || parsed.kind === 'failed') {
      if (!parsed.orderNo) {
        return { ok: false, ackSuccess: false, reason: 'PayPal 回调缺少商户订单号', rawPayload: raw };
      }
      return {
        ok: true,
        eventId,
        merchantOrderNo: parsed.orderNo,
        providerTradeNo: parsed.tradeNo || parsed.orderNo,
        providerRef: parsed.providerRef || parsed.orderNo,
        amountCents: Number.isFinite(parsed.amountCents) ? parsed.amountCents : 0,
        currency: parsed.currency,
        state: parsed.kind === 'closed' ? 'closed' : 'failed',
        providerStatus,
        ackSuccess: true,
        rawPayload: raw,
      };
    }

    return { ok: false, ackSuccess: false, reason: `PayPal 事件未处理: ${providerStatus}`, rawPayload: raw };
  }

  ack(result: NotificationResult): PaymentAck {
    const accepted = result.ok ? result.ackSuccess : false;
    return {
      status: accepted ? 200 : 400,
      body: JSON.stringify(
        accepted
          ? { received: true }
          : { received: false, message: (result.ok ? result.reason : result.reason).slice(0, 200) },
      ),
      contentType: 'application/json; charset=utf-8',
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    try {
      const capture = await this.resolveCapture(input);
      if (!capture.id) {
        return {
          state: 'failed',
          failureKind: 'definitive',
          error: '未找到可退款的 PayPal capture id',
        };
      }
      const result = await this.request(
        input.config,
        'POST',
        `/v2/payments/captures/${encodeURIComponent(capture.id)}/refund`,
        {
          amount: {
            currency_code: capture.currency,
            value: centsToYuan(input.amountCents),
          },
          custom_id: input.outRefundNo,
          invoice_id: input.outRefundNo,
          ...(input.reason ? { note_to_payer: input.reason.slice(0, 255) } : {}),
        },
        input.outRefundNo,
      );
      const id = asString(result?.id);
      const status = asString(result?.status);
      if (status === 'COMPLETED') {
        return { state: 'succeeded', providerRefundId: id, raw: safeJson(result) };
      }
      if (status === 'PENDING' || status === 'CREATED') {
        return { state: 'processing', providerRefundId: id, raw: safeJson(result) };
      }
      return {
        state: 'failed',
        failureKind:
          status === 'FAILED' || status === 'CANCELLED' || status === 'DENIED'
            ? 'definitive'
            : 'unknown',
        providerRefundId: id,
        error: `PayPal 退款状态: ${status || 'unknown'}`,
        raw: safeJson(result),
      };
    } catch (e) {
      return {
        state: 'failed',
        failureKind: 'unknown',
        error: `PayPal 退款失败: ${(e as Error).message}`,
      };
    }
  }

  private async resolveCapture(input: RefundInput): Promise<{ id: string; currency: PaymentCurrency }> {
    const values = input.config.values;
    if (input.providerRef?.trim()) {
      const order = await this.request(
        input.config,
        'GET',
        `/v2/checkout/orders/${encodeURIComponent(input.providerRef.trim())}`,
      );
      const capture = findCapture(order, input.providerTradeNo);
      if (capture) return capture;
    }
    if (input.providerTradeNo?.trim()) {
      const capture = await this.request(
        input.config,
        'GET',
        `/v2/payments/captures/${encodeURIComponent(input.providerTradeNo.trim())}`,
      );
      const id = asString(capture?.id);
      if (id) {
        const currency = asString(asObject(capture?.amount)?.currency_code).toUpperCase();
        return { id, currency: currency === 'USD' ? 'USD' : 'CNY' };
      }
    }
    throw new Error(`订单 ${input.orderNo} 缺少 PayPal capture id，且无法从渠道订单反查`);
  }

  private async request(
    config: PaymentContext,
    method: string,
    path: string,
    body?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    const token = await this.accessToken(config);
    const apiBase = (config.values.apiBase?.trim() || DEFAULT_API_BASE).replace(/\/$/, '');
    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'PayPal-Request-Id': idempotencyKey.slice(0, 108) } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    const json = parseJsonObject(text);
    if (!res.ok) {
      const details = asArray(json?.details)
        .map((item) => asString(asObject(item)?.description))
        .filter(Boolean)
        .join('；');
      throw new Error(details || asString(json?.message) || `HTTP ${res.status}`);
    }
    if (!json) throw new Error('PayPal 响应不是合法 JSON');
    return json;
  }

  private async accessToken(config: PaymentContext): Promise<string> {
    const v = config.values;
    const apiBase = (v.apiBase?.trim() || DEFAULT_API_BASE).replace(/\/$/, '');
    const cacheKey = `${apiBase}:${v.clientId}`;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;

    const basic = Buffer.from(`${v.clientId}:${v.clientSecret}`, 'utf8').toString('base64');
    const res = await fetch(`${apiBase}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    const json = parseJsonObject(text);
    if (!res.ok) {
      throw new Error(asString(json?.error_description) || asString(json?.error) || `OAuth HTTP ${res.status}`);
    }
    const accessToken = asString(json?.access_token);
    if (!accessToken) throw new Error('PayPal OAuth 未返回 access_token');
    const expiresIn = Number(json?.expires_in);
    this.tokenCache.set(cacheKey, {
      accessToken,
      expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 300) * 1000,
    });
    return accessToken;
  }
}

function mapOrder(orderNo: string, json: Record<string, unknown>): ProviderPaymentResult {
  const status = asString(json.status);
  const raw = safeJson(json);
  if (status === 'VOIDED') {
    return { state: 'closed', orderNo, providerStatus: status, rawPayload: raw };
  }

  const capture = findCapture(json);
  if (status === 'COMPLETED') {
    if (!capture) {
      return {
        state: 'failed',
        orderNo,
        providerStatus: status,
        error: 'PayPal 订单已完成但未返回 capture',
        rawPayload: raw,
      };
    }
    return {
      state: 'paid',
      orderNo,
      tradeNo: capture.id,
      amountCents: capture.amountCents,
      currency: capture.currency,
      paidAt: capture.paidAt,
      providerStatus: capture.status || status,
      rawPayload: raw,
    };
  }

  if (['CREATED', 'SAVED', 'APPROVED', 'PAYER_ACTION_REQUIRED'].includes(status)) {
    return {
      state: 'pending',
      orderNo,
      tradeNo: capture?.id,
      amountCents: capture?.amountCents,
      currency: capture?.currency,
      providerStatus: status,
      rawPayload: raw,
    };
  }

  return {
    state: 'failed',
    orderNo,
    providerStatus: status || 'UNKNOWN',
    error: `PayPal 订单状态未知: ${status || 'unknown'}`,
    rawPayload: raw,
  };
}

function findCapture(
  order: Record<string, unknown>,
  preferredCaptureId?: string,
): { id: string; status: string; amountCents: number; currency: PaymentCurrency; paidAt?: Date } | null {
  const captures = asArray(order.purchase_units).flatMap((unit) => {
    const payments = asObject(asObject(unit)?.payments);
    return asArray(payments?.captures).map(asObject).filter(Boolean) as Record<string, unknown>[];
  });
  const selected =
    captures.find((item) => asString(item.id) === preferredCaptureId) ||
    captures.find((item) => asString(item.status) === 'COMPLETED') ||
    captures[0];
  if (!selected) return null;

  const amount = asObject(selected.amount);
  const currencyCode = asString(amount?.currency_code).toUpperCase();
  return {
    id: asString(selected.id),
    status: asString(selected.status),
    amountCents: yuanToCents(asString(amount?.value)),
    currency: currencyCode === 'USD' ? 'USD' : 'CNY',
    paidAt: parseDate(asString(selected.create_time) || asString(selected.update_time)),
  };
}

function parsePayPalResource(
  resource: Record<string, unknown>,
  eventType: string,
): {
  kind: 'paid' | 'closed' | 'failed' | 'ignored';
  orderNo: string;
  tradeNo: string;
  providerRef: string;
  amountCents: number;
  currency: PaymentCurrency;
} {
  const units = asArray(resource.purchase_units).map(asObject).filter(Boolean) as Record<string, unknown>[];
  const captureEvent = eventType.startsWith('PAYMENT.CAPTURE.');
  const captureRecord = captureEvent ? resource : null;
  const captured = captureEvent ? null : findCapture({ purchase_units: units });
  const relatedIds = asObject(asObject(resource.supplementary_data)?.related_ids);
  const orderNo =
    asString(resource.custom_id) ||
    asString(resource.invoice_id) ||
    units.map((unit) => asString(unit.custom_id) || asString(unit.invoice_id)).find(Boolean) ||
    '';
  const amount =
    asObject(captureRecord?.amount) ||
    (captured
      ? {
          currency_code: captured.currency,
          value: centsToYuan(captured.amountCents),
        }
      : asObject(units[0]?.amount));
  const currencyCode = asString(amount?.currency_code).toUpperCase();

  let kind: 'paid' | 'closed' | 'failed' | 'ignored' = 'ignored';
  if (eventType === 'PAYMENT.CAPTURE.COMPLETED' || eventType === 'CHECKOUT.ORDER.COMPLETED') {
    kind = 'paid';
  } else if (eventType === 'CHECKOUT.ORDER.VOIDED') {
    kind = 'closed';
  } else if (
    ['PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.DECLINED', 'PAYMENT.CAPTURE.FAILED'].includes(eventType)
  ) {
    kind = 'failed';
  }

  return {
    kind,
    orderNo,
    tradeNo: asString(captureRecord?.id) || captured?.id || '',
    providerRef:
      captureEvent
        ? asString(relatedIds?.order_id) || asString(resource.order_id)
        : asString(resource.id),
    amountCents: yuanToCents(asString(amount?.value)),
    currency: currencyCode === 'USD' ? 'USD' : 'CNY',
  };
}

function orderNoFromOrder(order: Record<string, unknown>): string {
  const units = asArray(order.purchase_units).map(asObject).filter(Boolean) as Record<string, unknown>[];
  return (
    units.map((unit) => asString(unit.custom_id) || asString(unit.invoice_id) || asString(unit.reference_id)).find(Boolean) ||
    asString(order.custom_id) ||
    asString(order.invoice_id)
  );
}

function failed(orderNo: string, error: string): ProviderPaymentResult {
  return { state: 'failed', orderNo, error, providerStatus: 'CLIENT_ERROR', rawPayload: '' };
}

function isAllowedPayPalApiBase(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return false;
    return url.hostname === 'api-m.paypal.com' || url.hostname === 'api-m.sandbox.paypal.com';
  } catch {
    return false;
  }
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? (value[0] ?? '').trim() : String(value ?? '').trim();
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseDate(value: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
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
