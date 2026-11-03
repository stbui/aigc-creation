import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StripeAdapter, verifyStripeSignature } from './stripe.adapter';
import type { CreateOrderInput, NotificationInput, PaymentContext } from './types';

const WEBHOOK_SECRET = 'whsec_test_secret';

function makeConfig(): PaymentContext {
  return {
    providerId: 'stripe',
    configId: 'cfg_stripe_1',
    configVersion: 1,
    values: {
      secretKey: 'sk_test_example',
      webhookSecret: WEBHOOK_SECRET,
      apiBase: 'https://api.stripe.com',
    },
  };
}

function sign(rawBody: string, timestamp: number, secret = WEBHOOK_SECRET): string {
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

function notificationInput(
  event: Record<string, unknown>,
  overrides: Partial<NotificationInput> = {},
): NotificationInput {
  const rawBody = Buffer.from(JSON.stringify(event));
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    config: makeConfig(),
    headers: { 'stripe-signature': sign(rawBody.toString('utf8'), timestamp) },
    rawBody,
    body: event,
    ...overrides,
  };
}

function createOrderInput(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    config: makeConfig(),
    orderId: 'order_1',
    orderNo: 'HJ202611030001',
    amountCents: 1005,
    currency: 'CNY',
    subject: 'Testing credits',
    returnUrl: 'https://example.com/checkout/complete',
    notifyUrl: 'https://example.com/api/v1/payments/callback/stripe/cfg_stripe_1',
    expiresAt: new Date(Date.now() + 45 * 60_000),
    ...overrides,
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sessionEvent(
  type: string,
  paymentStatus: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `evt_${type.replaceAll('.', '_')}`,
    type,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'cs_test_1',
        client_reference_id: 'HJ202611030001',
        payment_intent: 'pi_test_1',
        amount_total: 1005,
        currency: 'cny',
        payment_status: paymentStatus,
        status: type === 'checkout.session.expired' ? 'expired' : 'complete',
        ...overrides,
      },
    },
  };
}

describe('verifyStripeSignature', () => {
  it('接受由 rawBody 与时间戳生成的 v1 签名', () => {
    const rawBody = '{"id":"evt_1","type":"checkout.session.completed"}';
    const timestamp = 1_800_000_000;
    expect(verifyStripeSignature(rawBody, sign(rawBody, timestamp), WEBHOOK_SECRET, timestamp)).toBe(
      true,
    );
  });

  it('拒绝被篡改的 rawBody', () => {
    const timestamp = 1_800_000_000;
    const original = '{"amount_total":1005}';
    const tampered = '{"amount_total":1}';
    expect(
      verifyStripeSignature(tampered, sign(original, timestamp), WEBHOOK_SECRET, timestamp),
    ).toBe(false);
  });

  it('拒绝超出 300 秒容忍窗口的时间戳', () => {
    const rawBody = '{"id":"evt_1"}';
    const timestamp = 1_800_000_000;
    expect(
      verifyStripeSignature(rawBody, sign(rawBody, timestamp), WEBHOOK_SECRET, timestamp + 301),
    ).toBe(false);
  });
});

describe('StripeAdapter API', () => {
  const adapter = new StripeAdapter();
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('创建 Checkout Session 时提交完整下单参数', async () => {
    const input = createOrderInput();
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 'cs_test_1',
        url: 'https://checkout.stripe.com/c/pay/cs_test_1',
        expires_at: Math.floor(input.expiresAt.getTime() / 1000),
      }),
    );

    const checkout = await adapter.createOrder(input);

    expect(checkout).toMatchObject({
      mode: 'redirect',
      providerRef: 'cs_test_1',
      payUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer sk_test_example');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('mode')).toBe('payment');
    expect(body.get('client_reference_id')).toBe(input.orderNo);
    expect(body.get('metadata[orderNo]')).toBe(input.orderNo);
    expect(body.get('payment_intent_data[metadata][orderNo]')).toBe(input.orderNo);
    expect(body.get('line_items[0][price_data][currency]')).toBe('cny');
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('1005');
    expect(body.get('success_url')).toBe(input.returnUrl);
    expect(body.get('cancel_url')).toBe(input.returnUrl);
    expect(body.get('expires_at')).toBe(String(Math.floor(input.expiresAt.getTime() / 1000)));
  });

  it('查单展开 PaymentIntent 并映射已支付状态', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 'cs_test_1',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 1005,
        currency: 'cny',
        payment_intent: { id: 'pi_test_1', status: 'succeeded' },
      }),
    );

    const result = await adapter.queryOrder({
      config: makeConfig(),
      orderNo: 'HJ202611030001',
      providerRef: 'cs_test_1',
    });

    expect(result).toMatchObject({
      state: 'paid',
      orderNo: 'HJ202611030001',
      tradeNo: 'pi_test_1',
      amountCents: 1005,
      currency: 'CNY',
      providerStatus: 'paid',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.stripe.com/v1/checkout/sessions/cs_test_1?expand%5B%5D=payment_intent',
    );
    expect(init.method).toBe('GET');
  });

  it('关单调用 Session expire 接口并映射为已关闭', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 'cs_test_1',
        status: 'expired',
        payment_status: 'unpaid',
        amount_total: 1005,
        currency: 'cny',
      }),
    );

    const result = await adapter.closeOrder({
      config: makeConfig(),
      orderNo: 'HJ202611030001',
      providerRef: 'cs_test_1',
    });

    expect(result.state).toBe('closed');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions/cs_test_1/expire');
    expect(init.method).toBe('POST');
  });

  it('退款使用 PaymentIntent、金额、元数据和稳定的幂等键', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 're_test_1', status: 'succeeded' }));

    const result = await adapter.refund({
      config: makeConfig(),
      orderNo: 'HJ202611030001',
      outRefundNo: 'RF202611030001',
      amountCents: 1005,
      totalCents: 1005,
      reason: '用户申请退款',
      providerTradeNo: 'pi_test_1',
    });

    expect(result).toMatchObject({ state: 'succeeded', providerRefundId: 're_test_1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/refunds');
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('RF202611030001');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('payment_intent')).toBe('pi_test_1');
    expect(body.get('amount')).toBe('1005');
    expect(body.get('metadata[refundNo]')).toBe('RF202611030001');
    expect(body.get('metadata[reason]')).toBe('用户申请退款');
  });

  it('退款缺少 PaymentIntent 时先按 Session 反查', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ id: 'cs_test_1', payment_intent: 'pi_from_session' }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 're_test_2', status: 'pending' }));

    const result = await adapter.refund({
      config: makeConfig(),
      orderNo: 'HJ202611030001',
      outRefundNo: 'RF202611030002',
      amountCents: 500,
      totalCents: 1005,
      providerRef: 'cs_test_1',
    });

    expect(result).toMatchObject({ state: 'processing', providerRefundId: 're_test_2' });
    const [sessionUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sessionUrl).toBe(
      'https://api.stripe.com/v1/checkout/sessions/cs_test_1?expand%5B%5D=payment_intent',
    );
    const [, refundInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(new URLSearchParams(String(refundInit.body)).get('payment_intent')).toBe(
      'pi_from_session',
    );
  });
});

describe('StripeAdapter.verifyNotification', () => {
  const adapter = new StripeAdapter();

  it('checkout.session.completed + paid 映射为已支付，并保留 Session/PaymentIntent', async () => {
    const result = await adapter.verifyNotification(
      notificationInput(sessionEvent('checkout.session.completed', 'paid')),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toMatchObject({
      state: 'paid',
      merchantOrderNo: 'HJ202611030001',
      providerRef: 'cs_test_1',
      providerTradeNo: 'pi_test_1',
      amountCents: 1005,
      currency: 'CNY',
      ackSuccess: true,
    });
  });

  it('checkout.session.completed + unpaid 保持 pending，不能提前入账', async () => {
    const result = await adapter.verifyNotification(
      notificationInput(sessionEvent('checkout.session.completed', 'unpaid')),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toBe('pending');
    expect(result.reason).toMatch(/等待异步支付/);
  });

  it('checkout.session.async_payment_succeeded 映射为已支付', async () => {
    const result = await adapter.verifyNotification(
      notificationInput(sessionEvent('checkout.session.async_payment_succeeded', 'paid')),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toBe('paid');
    expect(result.amountCents).toBe(1005);
  });

  it('checkout.session.async_payment_failed 映射为失败', async () => {
    const result = await adapter.verifyNotification(
      notificationInput(sessionEvent('checkout.session.async_payment_failed', 'unpaid')),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toBe('failed');
    expect(result.reason).toMatch(/异步支付失败/);
  });

  it('已支付事件缺少金额时拒绝入账', async () => {
    const event = sessionEvent('checkout.session.completed', 'paid');
    const data = event.data as { object: Record<string, unknown> };
    delete data.object.amount_total;

    const result = await adapter.verifyNotification(notificationInput(event));

    expect(result).toMatchObject({
      ok: false,
      ackSuccess: false,
      reason: 'Stripe 支付回调字段不完整',
    });
  });

  it('checkout.session.expired 映射为 closed', async () => {
    const result = await adapter.verifyNotification(
      notificationInput(sessionEvent('checkout.session.expired', 'unpaid')),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toBe('closed');
    expect(result.providerRef).toBe('cs_test_1');
  });
});
