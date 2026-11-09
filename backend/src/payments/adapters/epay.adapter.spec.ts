import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EpayAdapter,
  epayCallbackSign,
  epayCreateSign,
  verifyEpayCallbackSign,
} from './epay.adapter';
import type {
  CreateOrderInput,
  NotificationInput,
  PaymentContext,
  VisiblePaymentMethod,
} from './types';

const MCH_ID = '1547130349673';
const KEY = '123123';
const ORDER_NO = 'HJ202611030001';
const PROVIDER_ORDER_ID = '201901102220147500';

let fetchMock: ReturnType<typeof vi.fn>;

function makeConfig(overrides: Record<string, string> = {}): PaymentContext {
  return {
    providerId: 'epay',
    configId: 'cfg_epay_1',
    configVersion: 1,
    values: {
      apiBase: 'https://epay.jylt.cc',
      mchId: MCH_ID,
      key: KEY,
      type: '2',
      ...overrides,
    },
  };
}

function createInput(): CreateOrderInput {
  return {
    config: makeConfig(),
    orderId: 'order_1',
    orderNo: ORDER_NO,
    amountCents: 1005,
    currency: 'CNY',
    subject: '积分 100',
    returnUrl: 'https://app.example.com/checkout',
    notifyUrl: 'https://api.example.com/api/v1/payments/callback/epay/cfg_epay_1',
    expiresAt: new Date(Date.now() + 30 * 60_000),
  };
}

function callbackInput(
  body: Record<string, unknown>,
  options: {
    values?: Record<string, string>;
    expectedPaymentMethod?: VisiblePaymentMethod;
  } = {},
): NotificationInput {
  return {
    config: {
      ...makeConfig(options.values),
      ...(options.expectedPaymentMethod
        ? { paymentMethod: options.expectedPaymentMethod }
        : {}),
    },
    headers: {},
    rawBody: Buffer.from(new URLSearchParams(body as Record<string, string>).toString()),
    body,
    ...(options.expectedPaymentMethod
      ? { expectedPaymentMethod: options.expectedPaymentMethod }
      : {}),
  };
}

function paidBody(overrides: Record<string, string> = {}): Record<string, string> {
  const body: Record<string, string> = {
    mchId: MCH_ID,
    // 文档示例回调带 payId，但验签不包含该字段。
    payId: ORDER_NO,
    orderId: PROVIDER_ORDER_ID,
    param: ORDER_NO,
    type: '2',
    price: '10.05',
    reallyPrice: '10.05',
    ...overrides,
  };
  body.sign = epayCallbackSign(
    body.orderId,
    body.param,
    body.type,
    body.price,
    body.reallyPrice,
    KEY,
  );
  return body;
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
  };
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('易支付签名', () => {
  it('创建订单签名符合文档拼接规则', () => {
    expect(epayCreateSign('2023091239201001', 'uid:12', '2', '0.01', KEY)).toBe(
      '7bbd596ce8cee9bed866291b83f7c808',
    );
  });

  it('回调签名只拼接 orderId/param/type/price/reallyPrice/key', () => {
    const values = paidBody();
    expect(verifyEpayCallbackSign(values, KEY)).toBe(true);
    expect(verifyEpayCallbackSign({ ...values, price: '0.01' }, KEY)).toBe(false);
    expect(verifyEpayCallbackSign({ ...values, reallyPrice: '0.01' }, KEY)).toBe(false);
  });
});

describe('EpayAdapter.createOrder', () => {
  const adapter = new EpayAdapter();

  it('请求 /api/createOrder，传递文档字段并解析 isHtml=1 的 URL', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        code: 1,
        msg: '成功',
        data: 'https://epay.jylt.cc/pay/redirect?id=1',
      }),
    );

    const checkout = await adapter.createOrder(createInput());

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://epay.jylt.cc/api/createOrder');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      mchId: MCH_ID,
      payId: ORDER_NO,
      type: '2',
      price: '10.05',
      goodsName: '积分 100',
      param: ORDER_NO,
      isHtml: '1',
      notifyUrl: 'https://api.example.com/api/v1/payments/callback/epay/cfg_epay_1',
      returnUrl: 'https://app.example.com/checkout',
    });
    expect(url.searchParams.get('sign')).toBe(
      epayCreateSign(ORDER_NO, ORDER_NO, '2', '10.05', KEY),
    );
    expect(checkout).toMatchObject({
      mode: 'redirect',
      payUrl: 'https://epay.jylt.cc/pay/redirect?id=1',
    });
    expect(checkout.providerRef).toBeUndefined();
  });

  it('按前台固化方式使用支付宝 type=2，覆盖旧配置默认类型', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 1, data: 'https://epay.example.com/pay?id=ali' }),
    );
    const input = createInput();
    input.config = { ...makeConfig({ type: '1' }), paymentMethod: 'alipay' };

    await adapter.createOrder(input);

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('type')).toBe('2');
    expect(url.searchParams.get('sign')).toBe(
      epayCreateSign(ORDER_NO, ORDER_NO, '2', '10.05', KEY),
    );
  });

  it('按前台固化方式使用微信 type=1，覆盖旧配置默认类型', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 1, data: 'https://epay.example.com/pay?id=wx' }),
    );
    const input = createInput();
    input.config = { ...makeConfig({ type: '2' }), paymentMethod: 'wechat' };

    await adapter.createOrder(input);

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('type')).toBe('1');
    expect(url.searchParams.get('sign')).toBe(
      epayCreateSign(ORDER_NO, ORDER_NO, '1', '10.05', KEY),
    );
  });

  it('兼容 data 为订单对象，并保存云端 orderId 与较短有效期', async () => {
    const createdAt = Date.now();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        code: 1,
        data: {
          payId: ORDER_NO,
          orderId: PROVIDER_ORDER_ID,
          payUrl: 'https://epay.jylt.cc/pay/redirect?id=2',
          state: 0,
          timeOut: 5,
          date: createdAt,
        },
      }),
    );

    const checkout = await adapter.createOrder(createInput());

    expect(checkout.providerRef).toBe(PROVIDER_ORDER_ID);
    expect(checkout.payUrl).toBe('https://epay.jylt.cc/pay/redirect?id=2');
    expect(checkout.expiresAt.getTime()).toBe(createdAt + 5 * 60_000);
  });

  it('API 返回 code=-1 时拒绝下单', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: -1, msg: '商户不存在', data: null }));

    await expect(adapter.createOrder(createInput())).rejects.toThrow('商户不存在');
  });
});

describe('EpayAdapter.verifyNotification', () => {
  const adapter = new EpayAdapter();

  it('GET 参数回调映射为已支付，金额以 reallyPrice 为准', async () => {
    const result = await adapter.verifyNotification(callbackInput(paidBody()));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toMatchObject({
      state: 'paid',
      merchantOrderNo: ORDER_NO,
      providerTradeNo: PROVIDER_ORDER_ID,
      providerRef: PROVIDER_ORDER_ID,
      amountCents: 1005,
      currency: 'CNY',
      providerStatus: 'PAY_SUCCESS',
      eventId: `epay:${PROVIDER_ORDER_ID}:paid`,
      ackSuccess: true,
    });
  });

  it('篡改 price 或 reallyPrice 均拒绝回调', async () => {
    const priceTampered = { ...paidBody(), price: '0.01' };
    const reallyPriceTampered = { ...paidBody(), reallyPrice: '0.01' };

    await expect(adapter.verifyNotification(callbackInput(priceTampered))).resolves.toMatchObject({
      ok: false,
      ackSuccess: false,
    });
    await expect(
      adapter.verifyNotification(callbackInput(reallyPriceTampered)),
    ).resolves.toMatchObject({ ok: false, ackSuccess: false });
  });

  it('有固化支付方式时按支付宝/微信校验回调 type，而不是信任当前配置', async () => {
    const alipay = await adapter.verifyNotification(
      callbackInput(paidBody({ type: '2' }), {
        values: { type: '1' },
        expectedPaymentMethod: 'alipay',
      }),
    );
    const wechat = await adapter.verifyNotification(
      callbackInput(paidBody({ type: '1' }), {
        values: { type: '2' },
        expectedPaymentMethod: 'wechat',
      }),
    );

    expect(alipay).toMatchObject({ ok: true, amountCents: 1005 });
    expect(wechat).toMatchObject({ ok: true, amountCents: 1005 });
  });

  it('回调 type 与固化支付方式不一致时拒绝', async () => {
    const result = await adapter.verifyNotification(
      callbackInput(paidBody({ type: '2' }), {
        expectedPaymentMethod: 'wechat',
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      ackSuccess: false,
      reason: expect.stringContaining('支付类型'),
    });
  });

  it('历史订单没有固化方式时继续使用配置默认 type', async () => {
    const result = await adapter.verifyNotification(
      callbackInput(paidBody({ type: '1' }), { values: { type: '1' } }),
    );

    expect(result).toMatchObject({ ok: true, amountCents: 1005 });
  });

  it('mchId 或 type 与当前配置不一致时拒绝，即使签名本身正确', async () => {
    const wrongMchId = paidBody({ mchId: 'other-merchant' });
    const wrongType = paidBody({ type: '1' });

    await expect(adapter.verifyNotification(callbackInput(wrongMchId))).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining('商户 ID'),
    });
    await expect(adapter.verifyNotification(callbackInput(wrongType))).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining('支付类型'),
    });
  });

  it('金额格式非法时拒绝回调', async () => {
    const malformed = paidBody({ reallyPrice: '10.001' });
    await expect(adapter.verifyNotification(callbackInput(malformed))).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining('金额格式'),
    });
  });

  it('成功返回纯文本 success，失败返回 fail', () => {
    expect(
      adapter.ack({
        ok: true,
        eventId: 'evt_1',
        merchantOrderNo: ORDER_NO,
        providerTradeNo: PROVIDER_ORDER_ID,
        amountCents: 1005,
        currency: 'CNY',
        state: 'paid',
        providerStatus: 'PAY_SUCCESS',
        ackSuccess: true,
        rawPayload: '{}',
      }),
    ).toEqual({ status: 200, body: 'success', contentType: 'text/plain; charset=utf-8' });
    expect(
      adapter.ack({ ok: false, ackSuccess: false, reason: '验签失败', rawPayload: '{}' }),
    ).toEqual({ status: 400, body: 'fail', contentType: 'text/plain; charset=utf-8' });
  });
});

describe('EpayAdapter.queryOrder', () => {
  const adapter = new EpayAdapter();

  it.each([
    { state: 0, expected: 'pending' },
    { state: 1, expected: 'paid' },
    { state: 2, expected: 'paid' },
    { state: -1, expected: 'closed' },
    { state: 3, expected: 'failed' },
  ])('state=$state 映射为 $expected', async ({ state, expected }) => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        code: 1,
        msg: '成功',
        data: {
          payId: ORDER_NO,
          orderId: PROVIDER_ORDER_ID,
          payType: 2,
          price: 10.05,
          reallyPrice: 10.05,
          state,
          timeOut: 5,
          date: Date.now(),
        },
      }),
    );

    const result = await adapter.queryOrder({
      config: makeConfig(),
      orderNo: ORDER_NO,
      providerRef: PROVIDER_ORDER_ID,
    });

    expect(result.state).toBe(expected);
    expect(result.providerStatus).toBe(`EPAY_STATE_${state}`);
    if (expected === 'paid') expect(result.amountCents).toBe(1005);
  });

  it('没有云端 orderId 时使用 payId 查询', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        code: 1,
        data: { payId: ORDER_NO, orderId: PROVIDER_ORDER_ID, state: 0, reallyPrice: 10.05 },
      }),
    );

    await adapter.queryOrder({ config: makeConfig(), orderNo: ORDER_NO });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/getOrder');
    expect(url.searchParams.get('mchId')).toBe(MCH_ID);
    expect(url.searchParams.get('payId')).toBe(ORDER_NO);
    expect(url.searchParams.has('orderId')).toBe(false);
  });

  it('查单返回的订单标识不匹配时按 failed 处理，不能误入账', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        code: 1,
        data: {
          payId: 'other-order',
          orderId: PROVIDER_ORDER_ID,
          state: 1,
          reallyPrice: 10.05,
        },
      }),
    );

    await expect(
      adapter.queryOrder({ config: makeConfig(), orderNo: ORDER_NO, providerRef: PROVIDER_ORDER_ID }),
    ).resolves.toMatchObject({ state: 'failed', providerStatus: 'QUERY_FAILED' });
  });

  it('网络或报文异常返回 failed，而不是 not_found', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    await expect(
      adapter.queryOrder({ config: makeConfig(), orderNo: ORDER_NO }),
    ).resolves.toMatchObject({
      state: 'failed',
      providerStatus: 'QUERY_FAILED',
      error: expect.stringContaining('network down'),
    });
  });
});

describe('EpayAdapter 配置兼容与不支持的能力', () => {
  const adapter = new EpayAdapter();

  it('兼容旧 pid / payType 配置字段', () => {
    expect(
      adapter.validateConfig({
        apiBase: 'https://epay.jylt.cc',
        pid: MCH_ID,
        key: KEY,
        payType: 'alipay',
      }),
    ).toEqual([]);
  });

  it('关单、退款明确 failed，不伪造成功', async () => {
    await expect(
      adapter.closeOrder({ config: makeConfig(), orderNo: ORDER_NO }),
    ).resolves.toMatchObject({ state: 'failed', providerStatus: 'UNSUPPORTED' });
    await expect(
      adapter.refund({
        config: makeConfig(),
        orderNo: ORDER_NO,
        outRefundNo: 'RF202611030001',
        amountCents: 1005,
        totalCents: 1005,
      }),
    ).resolves.toMatchObject({ state: 'failed' });
  });
});
