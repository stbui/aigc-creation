import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaypalAdapter } from './paypal.adapter';
import type { CreateOrderInput, NotificationInput, PaymentContext } from './types';

const ORDER_NO = 'HJ202611030001';
const PAYPAL_ORDER_ID = '5O190127TN364715T';
const CAPTURE_ID = '3C679366HH908993F';

let fetchMock: ReturnType<typeof vi.fn>;

function makeConfig(): PaymentContext {
  return {
    providerId: 'paypal',
    configId: 'cfg_paypal_1',
    configVersion: 1,
    values: {
      clientId: 'paypal-client-id',
      clientSecret: 'paypal-client-secret',
      webhookId: 'WH-TEST-1',
      apiBase: 'https://api-m.sandbox.paypal.com',
    },
  };
}

function createInput(): CreateOrderInput {
  return {
    config: makeConfig(),
    orderId: 'order_1',
    orderNo: ORDER_NO,
    amountCents: 1005,
    currency: 'USD',
    subject: '积分 100',
    returnUrl: 'https://app.example.com/checkout?paymentReturn=1',
    notifyUrl: 'https://api.example.com/api/v1/payments/callback/paypal/cfg_paypal_1',
    expiresAt: new Date(Date.now() + 30 * 60_000),
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
  };
}

function oauthResponse() {
  return jsonResponse({ access_token: 'paypal-access-token', expires_in: 3600 });
}

function order(status: string, captures: Array<Record<string, unknown>> = []) {
  return {
    id: PAYPAL_ORDER_ID,
    status,
    purchase_units: [
      {
        custom_id: ORDER_NO,
        invoice_id: ORDER_NO,
        reference_id: ORDER_NO,
        payments: captures.length > 0 ? { captures } : undefined,
      },
    ],
  };
}

function capture(overrides: Record<string, unknown> = {}) {
  return {
    id: CAPTURE_ID,
    status: 'COMPLETED',
    amount: { currency_code: 'USD', value: '10.05' },
    create_time: '2026-11-03T10:00:00Z',
    ...overrides,
  };
}

function notificationInput(body: Record<string, unknown>): NotificationInput {
  return {
    config: makeConfig(),
    headers: {
      'paypal-transmission-id': 'transmission-1',
      'paypal-transmission-time': '2026-11-03T10:00:00Z',
      'paypal-cert-url': 'https://api.paypal.com/v1/notifications/certs/cert-1',
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-transmission-sig': 'signature',
    },
    rawBody: Buffer.from(JSON.stringify(body)),
    body,
  };
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PaypalAdapter.createOrder', () => {
  it('创建 CAPTURE intent 并返回 approve 链接', async () => {
    const adapter = new PaypalAdapter();
    fetchMock
      .mockResolvedValueOnce(oauthResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          id: PAYPAL_ORDER_ID,
          status: 'CREATED',
          links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=1' }],
        }),
      );

    const checkout = await adapter.createOrder(createInput());

    expect(checkout).toMatchObject({
      mode: 'redirect',
      providerRef: PAYPAL_ORDER_ID,
      payUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=1',
    });
    const request = fetchMock.mock.calls[1];
    expect(String(request[0])).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders');
    expect(request[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ 'PayPal-Request-Id': ORDER_NO }),
    });
    expect(JSON.parse(String(request[1].body))).toMatchObject({
      intent: 'CAPTURE',
      purchase_units: [
        expect.objectContaining({
          custom_id: ORDER_NO,
          invoice_id: ORDER_NO,
          amount: { currency_code: 'USD', value: '10.05' },
        }),
      ],
    });
  });
});

describe('PaypalAdapter.queryOrder', () => {
  it('APPROVED 时服务端 capture，并按 capture 结果映射已支付', async () => {
    const adapter = new PaypalAdapter();
    fetchMock
      .mockResolvedValueOnce(oauthResponse())
      .mockResolvedValueOnce(jsonResponse(order('APPROVED')))
      .mockResolvedValueOnce(jsonResponse(order('COMPLETED', [capture()])));

    const result = await adapter.queryOrder({
      config: makeConfig(),
      orderNo: ORDER_NO,
      providerRef: PAYPAL_ORDER_ID,
    });

    expect(result).toMatchObject({
      state: 'paid',
      orderNo: ORDER_NO,
      tradeNo: CAPTURE_ID,
      amountCents: 1005,
      currency: 'USD',
    });
    expect(fetchMock.mock.calls[2][0]).toBe(
      `https://api-m.sandbox.paypal.com/v2/checkout/orders/${PAYPAL_ORDER_ID}/capture`,
    );
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ 'PayPal-Request-Id': `capture:${ORDER_NO}` }),
    });
  });

  it('capture 响应丢失时重新查单，确认已完成仍可入账', async () => {
    const adapter = new PaypalAdapter();
    fetchMock
      .mockResolvedValueOnce(oauthResponse())
      .mockResolvedValueOnce(jsonResponse(order('APPROVED')))
      .mockResolvedValueOnce(jsonResponse({ name: 'INTERNAL_SERVER_ERROR' }, 500))
      .mockResolvedValueOnce(jsonResponse(order('COMPLETED', [capture()])));

    const result = await adapter.queryOrder({
      config: makeConfig(),
      orderNo: ORDER_NO,
      providerRef: PAYPAL_ORDER_ID,
    });

    expect(result.state).toBe('paid');
    expect(result.tradeNo).toBe(CAPTURE_ID);
  });
});

describe('PaypalAdapter.verifyNotification', () => {
  it('capture webhook 无 custom_id 时用 related order_id 反查商户订单号', async () => {
    const adapter = new PaypalAdapter();
    const event = {
      id: 'WH-EVENT-1',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: CAPTURE_ID,
        status: 'COMPLETED',
        amount: { currency_code: 'USD', value: '10.05' },
        create_time: '2026-11-03T10:00:00Z',
        supplementary_data: {
          related_ids: { order_id: PAYPAL_ORDER_ID },
        },
      },
    };
    fetchMock
      .mockResolvedValueOnce(oauthResponse())
      .mockResolvedValueOnce(jsonResponse({ verification_status: 'SUCCESS' }))
      .mockResolvedValueOnce(jsonResponse(order('COMPLETED', [capture()])));

    const result = await adapter.verifyNotification(notificationInput(event));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toMatchObject({
      eventId: 'WH-EVENT-1',
      state: 'paid',
      merchantOrderNo: ORDER_NO,
      providerTradeNo: CAPTURE_ID,
      providerRef: PAYPAL_ORDER_ID,
      amountCents: 1005,
      currency: 'USD',
      ackSuccess: true,
    });
    expect(fetchMock.mock.calls[2][0]).toBe(
      `https://api-m.sandbox.paypal.com/v2/checkout/orders/${PAYPAL_ORDER_ID}`,
    );
  });
});
