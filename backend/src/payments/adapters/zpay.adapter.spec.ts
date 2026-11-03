import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZpayAdapter, verifyZpaySign, zpaySign } from './zpay.adapter';
import type { CreateOrderInput, NotificationInput, PaymentContext } from './types';

const PID = '20220715225121';
const KEY = 'test-zpay-secret';
const ORDER_NO = 'HJ202611030001';
const TRADE_NO = '2016080622555342651';
const CLIENT_IP = '203.0.113.10';

let fetchMock: ReturnType<typeof vi.fn>;

function makeConfig(overrides: Record<string, string> = {}): PaymentContext {
  return {
    providerId: 'zpay',
    configId: 'cfg_zpay_1',
    configVersion: 1,
    values: {
      apiBase: 'https://zpayz.cn',
      pid: PID,
      key: KEY,
      type: 'alipay',
      ...overrides,
    },
  };
}

function createInput(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    config: makeConfig(),
    orderId: 'order_1',
    orderNo: ORDER_NO,
    amountCents: 1005,
    currency: 'CNY',
    subject: '积分 100',
    returnUrl: 'https://app.example.com/checkout',
    notifyUrl: 'https://api.example.com/api/v1/payments/callback/zpay/cfg_zpay_1',
    clientIp: CLIENT_IP,
    expiresAt: new Date(Date.now() + 30 * 60_000),
    ...overrides,
  };
}

function paidCallback(overrides: Record<string, string> = {}): Record<string, string> {
  const body: Record<string, string> = {
    pid: PID,
    name: '积分 100',
    money: '10.05',
    out_trade_no: ORDER_NO,
    trade_no: TRADE_NO,
    param: ORDER_NO,
    trade_status: 'TRADE_SUCCESS',
    type: 'alipay',
    sign_type: 'MD5',
    ...overrides,
  };
  body.sign = zpaySign(body, KEY);
  return body;
}

function notificationInput(body: Record<string, unknown>): NotificationInput {
  return {
    config: makeConfig(),
    headers: {},
    rawBody: Buffer.from(JSON.stringify(body)),
    body,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
  };
}

function formEntries(body: unknown): Record<string, string> {
  expect(body).toBeInstanceOf(FormData);
  return Object.fromEntries((body as FormData).entries()) as Record<string, string>;
}

function queryResponse(overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    code: 1,
    msg: '查询订单号成功！',
    pid: PID,
    out_trade_no: ORDER_NO,
    trade_no: TRADE_NO,
    type: 'alipay',
    name: '积分 100',
    money: '10.05',
    status: 1,
    ...overrides,
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ZPay 签名', () => {
  it('参数名按 ASCII 升序、排除 sign/sign_type/空值并直接拼接密钥', () => {
    const params = {
      pid: '1001',
      type: 'alipay',
      out_trade_no: ORDER_NO,
      notify_url: 'https://api.example.com/api/v1/payments/callback/zpay/cfg_zpay_1',
      name: '积分 100',
      money: '10.05',
      clientip: '127.0.0.1',
      device: 'pc',
      param: ORDER_NO,
      sign_type: 'MD5',
      empty: '',
    };

    expect(zpaySign(params, 'test-zpay-secret')).toBe('a0d73185ef274cdbd3c6fab2dc0c70a9');
  });

  it('验签接受正确小写 MD5，拒绝篡改', () => {
    const body = paidCallback();

    expect(verifyZpaySign(body, KEY)).toBe(true);
    expect(verifyZpaySign({ ...body, money: '0.01' }, KEY)).toBe(false);
    expect(verifyZpaySign({ ...body, sign: 'not-a-signature' }, KEY)).toBe(false);
  });
});

describe('ZpayAdapter.createOrder', () => {
  const adapter = new ZpayAdapter();

  it('以 multipart/form-data 调用 /mapi.php，并传递签名与 clientip', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        code: 1,
        msg: '成功',
        O_id: '123456',
        trade_no: TRADE_NO,
        payurl: 'https://zpayz.cn/pay/wxpay/202010903/',
        qrcode: 'https://zpayz.cn/qrcode/123',
      }),
    );

    const checkout = await adapter.createOrder(createInput());

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const form = formEntries(init.body);
    expect(url.origin + url.pathname).toBe('https://zpayz.cn/mapi.php');
    expect(init.method).toBe('POST');
    expect(form).toMatchObject({
      pid: PID,
      type: 'alipay',
      out_trade_no: ORDER_NO,
      notify_url: 'https://api.example.com/api/v1/payments/callback/zpay/cfg_zpay_1',
      name: '积分 100',
      money: '10.05',
      clientip: CLIENT_IP,
      device: 'pc',
      param: ORDER_NO,
      sign_type: 'MD5',
    });
    expect(form.sign).toBe(zpaySign(form, KEY));
    expect(checkout).toMatchObject({
      mode: 'redirect',
      payUrl: 'https://zpayz.cn/pay/wxpay/202010903/',
      providerRef: TRADE_NO,
    });
  });

  it('只有 qrcode 时返回扫码模式和二维码内容', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        code: 1,
        trade_no: TRADE_NO,
        qrcode: 'https://zpayz.cn/pay/wxpay/202010903/',
      }),
    );

    await expect(adapter.createOrder(createInput())).resolves.toMatchObject({
      mode: 'qrcode',
      payUrl: undefined,
      codeUrl: 'https://zpayz.cn/pay/wxpay/202010903/',
      providerRef: TRADE_NO,
    });
  });

  it('缺少服务端 clientIp 时拒绝下单，绝不发送空 clientip', async () => {
    await expect(
      adapter.createOrder(createInput({ clientIp: undefined })),
    ).rejects.toThrow(/缺少用户 IP/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('配置校验要求 pid/key/type，并兼容支付宝和微信取值', () => {
    expect(adapter.validateConfig({ pid: PID, key: KEY, type: 'alipay' })).toEqual([]);
    expect(adapter.validateConfig({ pid: PID, key: KEY, type: 'wxpay' })).toEqual([]);
    expect(adapter.validateConfig({ apiBase: 'https://zpayz.cn' })).toEqual([
      'pid',
      'key',
      'type',
    ]);
  });
});

describe('ZpayAdapter.verifyNotification', () => {
  const adapter = new ZpayAdapter();

  it('验签后主动查单，金额和渠道订单号一致才确认支付', async () => {
    fetchMock.mockResolvedValueOnce(queryResponse());

    const result = await adapter.verifyNotification(notificationInput(paidCallback()));

    expect(result).toMatchObject({
      ok: true,
      eventId: `zpay:${TRADE_NO}:paid`,
      merchantOrderNo: ORDER_NO,
      providerTradeNo: TRADE_NO,
      providerRef: TRADE_NO,
      amountCents: 1005,
      currency: 'CNY',
      state: 'paid',
      ackSuccess: true,
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/api.php');
    expect(url.searchParams.get('act')).toBe('order');
    expect(url.searchParams.get('pid')).toBe(PID);
    expect(url.searchParams.get('key')).toBe(KEY);
    expect(url.searchParams.get('out_trade_no')).toBe(ORDER_NO);
  });

  it('回调签名被篡改时拒绝，且不发起查单', async () => {
    const body = paidCallback();
    body.money = '0.01';

    await expect(adapter.verifyNotification(notificationInput(body))).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining('验签失败'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['商户 ID', { pid: 'other-pid' }],
    ['支付方式', { type: 'wxpay' }],
    ['支付状态', { trade_status: 'TRADE_CLOSED' }],
  ])('拒绝%s不匹配的回调', async (_label, overrides) => {
    await expect(
      adapter.verifyNotification(notificationInput(paidCallback(overrides))),
    ).resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('主动查单未支付时拒绝回调，不能凭通知入账', async () => {
    fetchMock.mockResolvedValueOnce(queryResponse({ status: 0 }));

    await expect(
      adapter.verifyNotification(notificationInput(paidCallback())),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining('主动查单未确认支付'),
    });
  });

  it('回调金额与主动查单金额不一致时拒绝', async () => {
    fetchMock.mockResolvedValueOnce(queryResponse({ money: '9.99' }));

    await expect(
      adapter.verifyNotification(notificationInput(paidCallback())),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining('金额与查单金额不一致'),
    });
  });

  it('查单返回的渠道订单号不一致时拒绝', async () => {
    fetchMock.mockResolvedValueOnce(queryResponse({ trade_no: 'OTHER-TRADE' }));

    await expect(
      adapter.verifyNotification(notificationInput(paidCallback())),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining('主动查单未确认支付'),
    });
  });

  it('成功返回纯文本 success，失败返回 fail', () => {
    expect(
      adapter.ack({
        ok: true,
        eventId: 'evt_1',
        merchantOrderNo: ORDER_NO,
        providerTradeNo: TRADE_NO,
        amountCents: 1005,
        currency: 'CNY',
        state: 'paid',
        providerStatus: 'TRADE_SUCCESS',
        ackSuccess: true,
        rawPayload: '{}',
      }),
    ).toEqual({ status: 200, body: 'success', contentType: 'text/plain; charset=utf-8' });
    expect(
      adapter.ack({ ok: false, ackSuccess: false, reason: '验签失败', rawPayload: '{}' }),
    ).toEqual({ status: 400, body: 'fail', contentType: 'text/plain; charset=utf-8' });
  });
});

describe('ZpayAdapter.queryOrder', () => {
  const adapter = new ZpayAdapter();

  it.each([
    { status: 0, expected: 'pending' },
    { status: 1, expected: 'paid' },
  ])('status=$status 映射为 $expected', async ({ status, expected }) => {
    fetchMock.mockResolvedValueOnce(queryResponse({ status }));

    await expect(
      adapter.queryOrder({ config: makeConfig(), orderNo: ORDER_NO, providerRef: TRADE_NO }),
    ).resolves.toMatchObject({
      state: expected,
      orderNo: ORDER_NO,
      providerStatus: `ZPAY_STATUS_${status}`,
      ...(expected === 'paid' ? { amountCents: 1005, tradeNo: TRADE_NO } : {}),
    });
  });

  it('未知状态、商户订单号不匹配和网络异常都按 failed 处理', async () => {
    fetchMock.mockResolvedValueOnce(queryResponse({ status: 9 }));
    await expect(
      adapter.queryOrder({ config: makeConfig(), orderNo: ORDER_NO }),
    ).resolves.toMatchObject({ state: 'failed', providerStatus: 'QUERY_FAILED' });

    fetchMock.mockResolvedValueOnce(queryResponse({ out_trade_no: 'other-order' }));
    await expect(
      adapter.queryOrder({ config: makeConfig(), orderNo: ORDER_NO }),
    ).resolves.toMatchObject({ state: 'failed', providerStatus: 'QUERY_FAILED' });

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

describe('ZpayAdapter 退款与关单', () => {
  const adapter = new ZpayAdapter();

  it('退款 POST /api.php?act=refund，并发送 pid/key/money/trade_no', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 1, msg: '退款成功' }));

    await expect(
      adapter.refund({
        config: makeConfig(),
        orderNo: ORDER_NO,
        outRefundNo: 'refund_1',
        amountCents: 1005,
        totalCents: 1005,
        providerTradeNo: TRADE_NO,
      }),
    ).resolves.toMatchObject({ state: 'succeeded' });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(url.pathname).toBe('/api.php');
    expect(url.searchParams.get('act')).toBe('refund');
    expect(init.method).toBe('POST');
    expect(formEntries(init.body)).toMatchObject({
      pid: PID,
      key: KEY,
      money: '10.05',
      trade_no: TRADE_NO,
    });
  });

  it('退款接口返回失败时明确 failed', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'error', msg: '通道不支持退款' }));

    await expect(
      adapter.refund({
        config: makeConfig(),
        orderNo: ORDER_NO,
        outRefundNo: 'refund_1',
        amountCents: 1005,
        totalCents: 1005,
      }),
    ).resolves.toMatchObject({
      state: 'failed',
      error: expect.stringContaining('通道不支持退款'),
    });
  });

  it('关单接口明确返回 failed/UNSUPPORTED', async () => {
    await expect(
      adapter.closeOrder({ config: makeConfig(), orderNo: ORDER_NO }),
    ).resolves.toMatchObject({ state: 'failed', providerStatus: 'UNSUPPORTED' });
  });
});
