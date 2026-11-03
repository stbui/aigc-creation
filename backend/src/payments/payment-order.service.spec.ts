import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { adapterMock } = vi.hoisted(() => ({
  adapterMock: {
    validateConfig: vi.fn(),
    createOrder: vi.fn(),
    queryOrder: vi.fn(),
    closeOrder: vi.fn(),
  },
}));

vi.mock('./adapters', () => ({
  getAdapter: () => adapterMock,
}));

import { PaymentOrderService } from './payment-order.service';

const ORDER_ID = 'order_1';
const CONFIG_ID = 'cfg_1';

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    orderNo: 'HJ20261102120000ABC',
    userId: 'user_1',
    status: 'pending',
    totalCents: 1000,
    paidCents: 1000,
    currency: 'CNY',
    channel: 'sandbox',
    membershipPlanId: null,
    providerConfigId: CONFIG_ID,
    providerConfigVersion: 1,
    checkoutMode: 'sandbox',
    checkoutValue: '/pay/sandbox?orderId=order_1',
    expiresAt: new Date(Date.now() + 10 * 60_000),
    providerPaidAt: null,
    paidAt: null,
    closedAt: null,
    lastError: null,
    lastQueriedAt: null,
    closeStartedAt: null,
    items: [{ skuSnapshot: 'credits-100' }],
    payments: [
      {
        id: 'pay_1',
        status: 'pending',
        channel: 'sandbox',
        providerConfigId: CONFIG_ID,
        payTransactionId: null,
        amountCents: 1000,
        createdAt: new Date(),
      },
    ],
    ...overrides,
  };
}

function makeHarness(order = makeOrder()) {
  const prisma = {
    order: {
      findUnique: vi.fn().mockResolvedValue(order),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    payment: {
      findFirst: vi.fn().mockResolvedValue({ id: 'pay_1' }),
      create: vi.fn().mockResolvedValue({ id: 'pay_new' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const orders = {
    markPaid: vi.fn().mockResolvedValue({ order: {}, idempotentHit: false }),
    releaseReservation: vi.fn().mockResolvedValue(undefined),
  };
  const configs = {
    available: vi.fn().mockResolvedValue([{ id: 'sandbox' }]),
    latest: vi.fn().mockResolvedValue({
      id: CONFIG_ID,
      providerId: 'sandbox',
      version: 1,
      enabled: true,
      closeAfterMinutes: 30,
      values: {},
    }),
    resolveForOrder: vi.fn(async ({ providerConfigId }: { providerConfigId: string | null }) => ({
      id: providerConfigId ?? CONFIG_ID,
      providerId: 'sandbox',
      version: 1,
      enabled: true,
      closeAfterMinutes: 30,
      values: {},
    })),
  };
  const service = new PaymentOrderService(prisma as never, orders as never, configs as never);
  return { service, prisma, orders, configs };
}

/** 断言没有发生「本地关单」 */
function expectNoLocalClose(prisma: ReturnType<typeof makeHarness>['prisma']) {
  const cancelled = prisma.order.updateMany.mock.calls.some(
    ([arg]) => (arg as { data?: { status?: string } })?.data?.status === 'cancelled',
  );
  expect(cancelled).toBe(false);
}

describe('PaymentOrderService.close', () => {  beforeEach(() => {
    adapterMock.validateConfig.mockReset().mockReturnValue([]);
    adapterMock.createOrder.mockReset();
    adapterMock.queryOrder.mockReset();
    adapterMock.closeOrder.mockReset();
  });

  it('渠道查单抛错时不本地关单，释放租约并返回 503', async () => {
    const { service, prisma } = makeHarness();
    adapterMock.queryOrder.mockRejectedValue(new Error('network down'));

    await expect(service.close({ orderId: ORDER_ID, actor: { kind: 'worker' } })).rejects.toThrow(
      /关单前查单失败/,
    );

    expectNoLocalClose(prisma);
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ closeStartedAt: null }),
      }),
    );
  });

  it('渠道关单返回 failed 时不本地关单', async () => {
    const { service, prisma } = makeHarness();
    adapterMock.queryOrder.mockResolvedValue({
      state: 'pending',
      orderNo: 'HJ20261102120000ABC',
      rawPayload: '',
    });
    adapterMock.closeOrder.mockResolvedValue({
      state: 'failed',
      orderNo: 'HJ20261102120000ABC',
      error: 'close rejected',
      rawPayload: '',
    });

    await expect(service.close({ orderId: ORDER_ID, actor: { kind: 'worker' } })).rejects.toThrow(
      /渠道关单未成功/,
    );

    expectNoLocalClose(prisma);
  });

  it('渠道查单已支付时先入账，不本地关单', async () => {
    const { service, prisma, orders } = makeHarness();
    adapterMock.queryOrder.mockResolvedValue({
      state: 'paid',
      orderNo: 'HJ20261102120000ABC',
      tradeNo: 'TRADE-1',
      amountCents: 1000,
      currency: 'CNY',
      paidAt: new Date('2026-11-02T02:00:00Z'),
      providerStatus: 'SUCCESS',
      rawPayload: '{"ok":true}',
    });

    await expect(service.close({ orderId: ORDER_ID, actor: { kind: 'worker' } })).rejects.toThrow(
      /渠道已支付/,
    );

    expect(orders.markPaid).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER_ID,
        payTransactionId: 'TRADE-1',
        channel: 'sandbox',
        providerConfigId: CONFIG_ID,
        amountCents: 1000,
        paymentId: 'pay_1',
      }),
    );
    expectNoLocalClose(prisma);
  });

  it('渠道已支付但未返回金额时拒绝入账', async () => {
    const { service, prisma, orders } = makeHarness();
    adapterMock.queryOrder.mockResolvedValue({
      state: 'paid',
      orderNo: 'HJ20261102120000ABC',
      tradeNo: 'TRADE-1',
      amountCents: undefined,
      rawPayload: '{}',
    });

    await expect(service.close({ orderId: ORDER_ID, actor: { kind: 'worker' } })).rejects.toThrow(
      /未返回金额/,
    );
    expect(orders.markPaid).not.toHaveBeenCalled();
    expectNoLocalClose(prisma);
  });

  it('渠道确认 pending 且关单成功时才本地关单', async () => {
    const { service, prisma, orders } = makeHarness();
    adapterMock.queryOrder.mockResolvedValue({
      state: 'pending',
      orderNo: 'HJ20261102120000ABC',
      rawPayload: '',
    });
    adapterMock.closeOrder.mockResolvedValue({
      state: 'closed',
      orderNo: 'HJ20261102120000ABC',
      rawPayload: '',
    });

    await service.close({ orderId: ORDER_ID, actor: { kind: 'worker' } });

    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'cancelled' }),
      }),
    );
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'closed' }),
      }),
    );
    expect(orders.releaseReservation).toHaveBeenCalledWith(ORDER_ID);
  });

  it('多渠道尝试逐个查单：旧尝试已关闭才不会漏掉已付款', async () => {
    const order = makeOrder({
      providerConfigId: 'cfg_2',
      payments: [
        {
          id: 'pay_2',
          status: 'pending',
          channel: 'sandbox',
          providerConfigId: 'cfg_2',
          payTransactionId: null,
          amountCents: 1000,
          createdAt: new Date(),
        },
        {
          id: 'pay_1',
          status: 'closed',
          channel: 'sandbox',
          providerConfigId: 'cfg_1',
          payTransactionId: null,
          amountCents: 1000,
          createdAt: new Date(Date.now() - 60_000),
        },
      ],
    });
    const { service, orders } = makeHarness(order);
    adapterMock.queryOrder
      .mockResolvedValueOnce({
        state: 'not_found',
        orderNo: order.orderNo,
        providerStatus: 'NOT_FOUND',
        rawPayload: '',
      })
      .mockResolvedValueOnce({
        state: 'paid',
        orderNo: order.orderNo,
        tradeNo: 'TRADE-OLD',
        amountCents: 1000,
        currency: 'CNY',
        paidAt: new Date(),
        providerStatus: 'SUCCESS',
        rawPayload: '{}',
      });

    await expect(service.close({ orderId: ORDER_ID, actor: { kind: 'worker' } })).rejects.toThrow(
      /渠道已支付/,
    );

    expect(adapterMock.queryOrder).toHaveBeenCalledTimes(2);
    expect(orders.markPaid).toHaveBeenCalledWith(
      expect.objectContaining({ payTransactionId: 'TRADE-OLD', paymentId: 'pay_1' }),
    );
  });
});

describe('PaymentOrderService.createIntent', () => {
  const previousWebBase = process.env.WEB_BASE_URL;
  const previousNotifyBase = process.env.PAYMENT_NOTIFY_BASE;

  beforeEach(() => {
    adapterMock.validateConfig.mockReset().mockReturnValue([]);
    adapterMock.createOrder.mockReset();
    adapterMock.queryOrder.mockReset();
    adapterMock.closeOrder.mockReset();
    process.env.WEB_BASE_URL = 'https://app.example.com';
    process.env.PAYMENT_NOTIFY_BASE = 'https://api.example.com';
  });

  afterEach(() => {
    if (previousWebBase === undefined) delete process.env.WEB_BASE_URL;
    else process.env.WEB_BASE_URL = previousWebBase;
    if (previousNotifyBase === undefined) delete process.env.PAYMENT_NOTIFY_BASE;
    else process.env.PAYMENT_NOTIFY_BASE = previousNotifyBase;
  });

  it('真实渠道完成后回到原订单结算页，并带上主动查单标记', async () => {
    const { service, configs } = makeHarness(
      makeOrder({
        channel: 'alipay',
        checkoutMode: 'redirect',
        items: [{ skuSnapshot: 'credits-100' }],
      }),
    );
    configs.available.mockResolvedValue([{ id: 'alipay' }]);
    configs.latest.mockResolvedValue({
      id: CONFIG_ID,
      providerId: 'alipay',
      version: 1,
      enabled: true,
      closeAfterMinutes: 30,
      values: {},
    });
    adapterMock.createOrder.mockResolvedValue({
      mode: 'redirect',
      payUrl: 'https://openapi.alipay.com/gateway.do?sign=test',
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    await service.createIntent({ orderId: ORDER_ID, userId: 'user_1', providerId: 'alipay' });

    expect(adapterMock.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        returnUrl:
          'https://app.example.com/checkout/credits-100?orderId=order_1&paymentReturn=1',
      }),
    );
  });

  it('把渠道返回的 providerRef 持久化到对应 Payment', async () => {
    const { service, prisma, configs } = makeHarness(
      makeOrder({
        channel: 'stripe',
        checkoutMode: 'redirect',
        items: [{ skuSnapshot: 'credits-100' }],
      }),
    );
    configs.available.mockResolvedValue([{ id: 'stripe' }]);
    configs.latest.mockResolvedValue({
      id: CONFIG_ID,
      providerId: 'stripe',
      version: 1,
      enabled: true,
      closeAfterMinutes: 30,
      values: {},
    });
    adapterMock.createOrder.mockResolvedValue({
      mode: 'redirect',
      payUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
      providerRef: 'cs_test_1',
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    await service.createIntent({ orderId: ORDER_ID, userId: 'user_1', providerId: 'stripe' });

    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay_new', status: 'pending' },
        data: { providerRef: 'cs_test_1' },
      }),
    );
  });

  it('把服务端提取的客户端 IP 原样传给渠道下单', async () => {
    const { service, configs } = makeHarness(
      makeOrder({
        channel: 'zpay',
        checkoutMode: 'redirect',
        items: [{ skuSnapshot: 'credits-100' }],
      }),
    );
    configs.available.mockResolvedValue([{ id: 'zpay' }]);
    configs.latest.mockResolvedValue({
      id: CONFIG_ID,
      providerId: 'zpay',
      version: 1,
      enabled: true,
      closeAfterMinutes: 30,
      values: { pid: 'merchant', key: 'secret', type: 'alipay' },
    });
    adapterMock.createOrder.mockResolvedValue({
      mode: 'redirect',
      payUrl: 'https://zpayz.cn/pay/1',
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    await service.createIntent({
      orderId: ORDER_ID,
      userId: 'user_1',
      providerId: 'zpay',
      clientIp: '203.0.113.10',
    });

    expect(adapterMock.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ clientIp: '203.0.113.10' }),
    );
  });

  it('会员订单完成后回到会员结算页', async () => {
    const { service, configs } = makeHarness(
      makeOrder({
        channel: 'alipay',
        checkoutMode: 'redirect',
        membershipPlanId: 'plan_1',
        items: [],
      }),
    );
    configs.available.mockResolvedValue([{ id: 'alipay' }]);
    configs.latest.mockResolvedValue({
      id: CONFIG_ID,
      providerId: 'alipay',
      version: 1,
      enabled: true,
      closeAfterMinutes: 30,
      values: {},
    });
    adapterMock.createOrder.mockResolvedValue({
      mode: 'redirect',
      payUrl: 'https://openapi.alipay.com/gateway.do?sign=test',
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    await service.createIntent({ orderId: ORDER_ID, userId: 'user_1', providerId: 'alipay' });

    expect(adapterMock.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        returnUrl:
          'https://app.example.com/checkout/membership?orderId=order_1&paymentReturn=1',
      }),
    );
  });
});

describe('PaymentOrderService.query', () => {
  beforeEach(() => {
    adapterMock.queryOrder.mockReset();
    adapterMock.queryOrder.mockResolvedValue({
      state: 'pending',
      orderNo: 'HJ20261102120000ABC',
      rawPayload: '',
    });
  });

  it('主动刷新绕过 2 秒查单节流', async () => {
    const { service } = makeHarness(makeOrder({ lastQueriedAt: new Date() }));

    await service.query({
      orderId: ORDER_ID,
      actor: { kind: 'user', userId: 'user_1' },
      force: true,
    });

    expect(adapterMock.queryOrder).toHaveBeenCalledTimes(1);
  });

  it('普通轮询在节流窗口内不发渠道请求', async () => {
    const { service } = makeHarness(makeOrder({ lastQueriedAt: new Date() }));

    await service.query({ orderId: ORDER_ID, actor: { kind: 'user', userId: 'user_1' } });

    expect(adapterMock.queryOrder).not.toHaveBeenCalled();
  });

  it('不同 providerRef 的 pending 尝试分别查单并透传单据号', async () => {
    const order = makeOrder({
      providerConfigId: CONFIG_ID,
      payments: [
        {
          id: 'pay_new',
          status: 'pending',
          channel: 'stripe',
          providerConfigId: CONFIG_ID,
          providerRef: 'cs_new',
          payTransactionId: null,
          amountCents: 1000,
          createdAt: new Date(),
        },
        {
          id: 'pay_old',
          status: 'pending',
          channel: 'stripe',
          providerConfigId: CONFIG_ID,
          providerRef: 'cs_old',
          payTransactionId: null,
          amountCents: 1000,
          createdAt: new Date(Date.now() - 60_000),
        },
      ],
    });
    const { service, configs } = makeHarness(order);
    configs.resolveForOrder.mockResolvedValue({
      id: CONFIG_ID,
      providerId: 'stripe',
      version: 1,
      enabled: true,
      closeAfterMinutes: 30,
      values: {},
    });

    await service.query({
      orderId: ORDER_ID,
      actor: { kind: 'user', userId: 'user_1' },
      force: true,
    });

    expect(adapterMock.queryOrder).toHaveBeenCalledTimes(2);
    expect(adapterMock.queryOrder.mock.calls[0][0]).toMatchObject({ providerRef: 'cs_new' });
    expect(adapterMock.queryOrder.mock.calls[1][0]).toMatchObject({ providerRef: 'cs_old' });
  });
});

describe('PaymentOrderService.notifyUrl', () => {
  const previous = process.env.PAYMENT_NOTIFY_BASE;
  const previousHost = process.env.HOST;
  const previousPort = process.env.PORT;
  afterEach(() => {
    if (previous === undefined) delete process.env.PAYMENT_NOTIFY_BASE;
    else process.env.PAYMENT_NOTIFY_BASE = previous;
    if (previousHost === undefined) delete process.env.HOST;
    else process.env.HOST = previousHost;
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
  });

  it('渠道 publicBaseUrl 优先于全局 PAYMENT_NOTIFY_BASE', () => {
    process.env.PAYMENT_NOTIFY_BASE = 'https://global.example.com';
    const { service } = makeHarness();
    expect(service.notifyUrl('alipay', 'cfg_1', 'https://pay.example.com/')).toBe(
      'https://pay.example.com/api/v1/payments/callback/alipay/cfg_1',
    );
  });

  it('未配置渠道地址时回落全局基址', () => {
    process.env.PAYMENT_NOTIFY_BASE = 'https://global.example.com';
    const { service } = makeHarness();
    expect(service.notifyUrl('wechat', 'cfg_2')).toBe(
      'https://global.example.com/api/v1/payments/callback/wechat/cfg_2',
    );
  });

  it('两者都没有时回落到本机地址', () => {
    delete process.env.PAYMENT_NOTIFY_BASE;
    const { service } = makeHarness();
    process.env.HOST = '127.0.0.1';
    process.env.PORT = '4100';
    expect(service.notifyUrl('sandbox', 'cfg_3')).toBe(
      'http://127.0.0.1:4100/api/v1/payments/callback/sandbox/cfg_3',
    );
  });

  it('真实渠道没有回调公网地址时拒绝发起支付', () => {
    delete process.env.PAYMENT_NOTIFY_BASE;
    const { service } = makeHarness();
    expect(() => service.notifyUrl('alipay', 'cfg_1')).toThrow(
      /真实支付渠道缺少回调公网地址/,
    );
  });
});
