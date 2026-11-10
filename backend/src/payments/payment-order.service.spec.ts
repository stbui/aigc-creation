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
import type { VisiblePaymentOption } from './payment-config.service';

const ORDER_ID = 'order_1';
const CONFIG_ID = 'cfg_1';

function makePaymentRules(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    productNamePrefix: '',
    productNameSuffix: '',
    minAmountCents: 1,
    maxAmountCents: null,
    dailyLimitCents: null,
    orderTtlMinutes: 30,
    maxPendingOrders: 3,
    cancelLimitEnabled: false,
    cancelWindowMode: 'rolling',
    cancelWindowSize: 10,
    cancelWindowUnit: 'minute',
    cancelLimitMax: 5,
    loadBalancingStrategy: 'round-robin',
    alipayMobilePrecreateDeepLink: false,
    helpImage: '',
    helpText: '',
    ...overrides,
  };
}

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

function makeVisibleOption(method: 'alipay' | 'wechat'): VisiblePaymentOption {
  return {
    view: {
      id: method,
      name: method === 'alipay' ? '支付宝' : '微信支付',
      icon: method,
      checkoutMode: 'qrcode',
      supportedCurrencies: ['CNY'],
      sandbox: false,
    },
    resolved: {
      method,
      providerId: method,
      config: {
        id: CONFIG_ID,
        providerId: method,
        instanceId: 'default',
        name: null,
        sortOrder: 0,
        version: 1,
        enabled: true,
        closeAfterMinutes: 30,
        minAmountCents: null,
        maxAmountCents: null,
        dailyLimitCents: null,
        refundEnabled: true,
        paymentMethods: [method],
        values: {},
      },
    },
  };
}

function makeHarness(order = makeOrder()) {
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(prisma),
    ),
    $executeRaw: vi.fn().mockResolvedValue(0),
    order: {
      findUnique: vi.fn().mockResolvedValue(order),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    payment: {
      findFirst: vi.fn().mockResolvedValue({ id: 'pay_1' }),
      findMany: vi.fn().mockResolvedValue([{ id: 'pay_1', providerInstanceId: 'default' }]),
      create: vi.fn().mockResolvedValue({ id: 'pay_new' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    orderCancelEvent: {
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'cancel_1' }),
      update: vi.fn().mockResolvedValue({ id: 'cancel_1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const orders = {
    markPaid: vi.fn().mockResolvedValue({ order: {}, idempotentHit: false }),
    releaseReservation: vi.fn().mockResolvedValue(undefined),
  };
  const configs = {
    availableVisible: vi.fn().mockResolvedValue([
      makeVisibleOption('alipay').view,
      makeVisibleOption('wechat').view,
    ]),
    resolveVisibleOptions: vi.fn().mockResolvedValue([
      makeVisibleOption('alipay'),
      makeVisibleOption('wechat'),
    ]),
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
    claimVisibleSelection: vi.fn(async (resolved: unknown) => resolved),
    releaseVisibleSelection: vi.fn().mockResolvedValue(undefined),
    reserveVisiblePaymentAttempt: vi.fn(
      async (input: {
        method: 'alipay' | 'wechat';
        currency: string;
        amountCents: number;
        orderId: string;
        userId: string;
        resolved?: ReturnType<typeof makeVisibleOption>['resolved'];
      }) => {
        const resolved = input.resolved ?? makeVisibleOption(input.method).resolved;
        const payment = await prisma.payment.create({
          data: {
            orderId: input.orderId,
            userId: input.userId,
            channel: resolved.providerId,
            providerMethod: input.method,
            amountCents: input.amountCents,
            currency: input.currency,
            status: 'pending',
            providerConfigId: resolved.config.id,
            providerConfigVersion: resolved.config.version,
            providerInstanceId: resolved.config.instanceId,
          },
        });
        return { payment, resolved };
      },
    ),
  };
  const settings = {
    paymentRules: vi.fn().mockResolvedValue(makePaymentRules()),
  };
  const service = new PaymentOrderService(
    prisma as never,
    orders as never,
    configs as never,
    settings as never,
  );
  return { service, prisma, orders, configs, settings };
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
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: ORDER_ID,
          closeStartedAt: expect.any(Date),
        }),
        data: expect.objectContaining({ closeStartedAt: null }),
      }),
    );
  });

  it('另一请求正在发起支付时不抢关单租约', async () => {
    const { service, prisma } = makeHarness(
      makeOrder({ intentStartedAt: new Date() }),
    );
    prisma.order.updateMany.mockResolvedValueOnce({ count: 0 });

    await service.close({ orderId: ORDER_ID, actor: { kind: 'worker' } });

    expect(adapterMock.queryOrder).not.toHaveBeenCalled();
    expectNoLocalClose(prisma);
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

  it('渠道已支付但入账失败时只释放自己的关单租约', async () => {
    const { service, prisma, orders } = makeHarness();
    orders.markPaid.mockRejectedValue(new Error('lock timeout'));
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

    await expect(
      service.close({ orderId: ORDER_ID, actor: { kind: 'worker' } }),
    ).rejects.toThrow(/lock timeout/);

    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: ORDER_ID,
          closeStartedAt: expect.any(Date),
        }),
        data: {
          closeStartedAt: null,
          lastError: expect.stringContaining('渠道已支付但入账失败'),
        },
      }),
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
    expect(orders.releaseReservation).toHaveBeenCalledWith(
      ORDER_ID,
      expect.objectContaining({ order: prisma.order }),
    );
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

  it('用户主动取消成功时预留并消费取消额度', async () => {
    const { service, prisma, settings } = makeHarness(
      makeOrder({ payments: [], providerConfigId: null, checkoutMode: null }),
    );
    settings.paymentRules.mockResolvedValue(
      makePaymentRules({ cancelLimitEnabled: true, cancelLimitMax: 3 }),
    );

    await service.close({
      orderId: ORDER_ID,
      actor: { kind: 'user', userId: 'user_1' },
    });

    expect(prisma.orderCancelEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: ORDER_ID,
        userId: 'user_1',
        status: 'reserved',
        windowMode: 'rolling',
      }),
      select: { id: true },
    });
    expect(prisma.orderCancelEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'cancel_1', orderId: ORDER_ID, status: 'reserved' },
      data: expect.objectContaining({ status: 'consumed' }),
    });
  });

  it('取消额度不足时拒绝取消且不向渠道查单', async () => {
    const { service, prisma, settings } = makeHarness();
    settings.paymentRules.mockResolvedValue(
      makePaymentRules({ cancelLimitEnabled: true, cancelLimitMax: 1 }),
    );
    prisma.orderCancelEvent.count.mockResolvedValue(1);

    await expect(
      service.close({
        orderId: ORDER_ID,
        actor: { kind: 'user', userId: 'user_1' },
      }),
    ).rejects.toThrow(/取消订单过于频繁/);

    expect(adapterMock.queryOrder).not.toHaveBeenCalled();
    expect(prisma.orderCancelEvent.create).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ closeStartedAt: expect.any(Date) }),
        data: { closeStartedAt: null },
      }),
    );
  });

  it('取消失败时释放额度，保留订单待支付', async () => {
    const { service, prisma, settings } = makeHarness();
    settings.paymentRules.mockResolvedValue(
      makePaymentRules({ cancelLimitEnabled: true }),
    );
    adapterMock.queryOrder.mockRejectedValue(new Error('network down'));

    await expect(
      service.close({
        orderId: ORDER_ID,
        actor: { kind: 'user', userId: 'user_1' },
      }),
    ).rejects.toThrow(/关单前查单失败/);

    expect(prisma.orderCancelEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'cancel_1', status: 'reserved' },
      data: expect.objectContaining({ status: 'released' }),
    });
    expectNoLocalClose(prisma);
  });

  it('管理员与超时关单不计入取消额度', async () => {
    const { service, prisma, settings } = makeHarness(
      makeOrder({ payments: [], providerConfigId: null, checkoutMode: null }),
    );
    settings.paymentRules.mockResolvedValue(
      makePaymentRules({ cancelLimitEnabled: true }),
    );

    await service.close({ orderId: ORDER_ID, actor: { kind: 'worker' } });

    expect(prisma.orderCancelEvent.findUnique).not.toHaveBeenCalled();
    expect(prisma.orderCancelEvent.count).not.toHaveBeenCalled();
    expect(prisma.orderCancelEvent.create).not.toHaveBeenCalled();
  });

  it('同一订单已有取消记录时不重复占额度', async () => {
    const { service, prisma, settings } = makeHarness(
      makeOrder({ payments: [], providerConfigId: null, checkoutMode: null }),
    );
    settings.paymentRules.mockResolvedValue(
      makePaymentRules({ cancelLimitEnabled: true }),
    );
    prisma.orderCancelEvent.findUnique.mockResolvedValue({
      id: 'cancel_existing',
      status: 'consumed',
    });

    await service.close({
      orderId: ORDER_ID,
      actor: { kind: 'user', userId: 'user_1' },
    });

    expect(prisma.orderCancelEvent.count).not.toHaveBeenCalled();
    expect(prisma.orderCancelEvent.create).not.toHaveBeenCalled();
  });
});

describe('PaymentOrderService.applyPaymentResult', () => {
  it('没有精确 paymentId 且存在多条待支付尝试时拒绝自动归属', async () => {
    const { service, prisma, orders } = makeHarness();
    prisma.payment.findMany.mockResolvedValue([
      { id: 'pay_1', providerInstanceId: 'default' },
      { id: 'pay_2', providerInstanceId: 'default' },
    ]);

    await expect(
      service.applyPaymentResult({
        orderId: ORDER_ID,
        providerId: 'alipay',
        configId: CONFIG_ID,
        providerInstanceId: 'default',
        tradeNo: 'TRADE-AMBIGUOUS',
        amountCents: 1000,
        currency: 'CNY',
        paidAt: new Date(),
        rawPayload: '{}',
      }),
    ).rejects.toThrow(/多条待支付尝试/);

    expect(orders.markPaid).not.toHaveBeenCalled();
  });

  it('只有一条待支付尝试时才允许自动归属', async () => {
    const { service, prisma, orders } = makeHarness();
    prisma.payment.findMany.mockResolvedValue([
      { id: 'pay_only', providerInstanceId: 'default' },
    ]);

    await expect(
      service.applyPaymentResult({
        orderId: ORDER_ID,
        providerId: 'alipay',
        configId: CONFIG_ID,
        providerInstanceId: 'default',
        tradeNo: 'TRADE-UNIQUE',
        amountCents: 1000,
        currency: 'CNY',
        paidAt: new Date(),
        rawPayload: '{}',
      }),
    ).resolves.toEqual({ applied: true, idempotentHit: false });

    expect(orders.markPaid).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'pay_only', payTransactionId: 'TRADE-UNIQUE' }),
    );
  });
});

describe('PaymentOrderService.createIntent', () => {
  const previousWebBase = process.env.WEB_BASE_URL;
  const previousNotifyBase = process.env.PAYMENT_NOTIFY_BASE;

  beforeEach(() => {
    adapterMock.validateConfig.mockReset().mockReturnValue([]);
    adapterMock.createOrder.mockReset();
    adapterMock.queryOrder.mockReset().mockResolvedValue({
      state: 'pending',
      orderNo: 'HJ20261102120000ABC',
      rawPayload: '',
    });
    adapterMock.closeOrder.mockReset().mockResolvedValue({
      state: 'closed',
      orderNo: 'HJ20261102120000ABC',
      rawPayload: '',
    });
    process.env.WEB_BASE_URL = 'https://app.example.com';
    process.env.PAYMENT_NOTIFY_BASE = 'https://api.example.com';
  });

  afterEach(() => {
    if (previousWebBase === undefined) delete process.env.WEB_BASE_URL;
    else process.env.WEB_BASE_URL = previousWebBase;
    if (previousNotifyBase === undefined) delete process.env.PAYMENT_NOTIFY_BASE;
    else process.env.PAYMENT_NOTIFY_BASE = previousNotifyBase;
  });

  it('管理员未选择来源时不接受发起支付', async () => {
    const { service, configs, prisma } = makeHarness();
    configs.resolveVisibleOptions.mockResolvedValue([]);

    await expect(
      service.createIntent({ orderId: ORDER_ID, userId: 'user_1', providerId: 'alipay' }),
    ).rejects.toThrow(/管理员尚未选择可用支付来源/);

    expect(adapterMock.createOrder).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('存在多个可见支付方式时要求显式选择', async () => {
    const { service, configs } = makeHarness();
    configs.resolveVisibleOptions.mockResolvedValue([
      makeVisibleOption('alipay'),
      makeVisibleOption('wechat'),
    ]);

    await expect(service.createIntent({ orderId: ORDER_ID, userId: 'user_1' })).rejects.toThrow(
      /请指定 providerId/,
    );
  });

  it('拒绝把真实渠道 id 当作前台支付方式', async () => {
    const { service } = makeHarness();

    await expect(
      service.createIntent({ orderId: ORDER_ID, userId: 'user_1', providerId: 'epay' }),
    ).rejects.toThrow(/支付方式不可用/);
  });

  it('指定来源不可用时不回退到另一来源', async () => {
    const { service, configs } = makeHarness();
    configs.resolveVisibleOptions.mockResolvedValue([makeVisibleOption('wechat')]);

    await expect(
      service.createIntent({ orderId: ORDER_ID, userId: 'user_1', providerId: 'alipay' }),
    ).rejects.toThrow(/支付方式不可用/);
  });

  it('易支付来源固化可见支付方式并把 type 交给适配器', async () => {
    const { service, prisma, configs } = makeHarness();
    configs.resolveVisibleOptions.mockResolvedValue([
      {
        view: {
          id: 'alipay',
          name: '支付宝',
          icon: 'alipay',
          checkoutMode: 'redirect',
          supportedCurrencies: ['CNY'],
          sandbox: false,
        },
        resolved: {
          method: 'alipay',
          providerId: 'epay',
          providerMethod: 'alipay',
          config: {
            id: CONFIG_ID,
            providerId: 'epay',
            instanceId: 'default',
            name: null,
            sortOrder: 0,
            version: 3,
            enabled: true,
            closeAfterMinutes: 30,
            minAmountCents: null,
            maxAmountCents: null,
            dailyLimitCents: null,
            refundEnabled: true,
            paymentMethods: ['alipay', 'wechat'],
            values: { mchId: 'pid', key: 'secret', apiBase: 'https://epay.example.com' },
          },
        },
      },
    ]);
    adapterMock.createOrder.mockResolvedValue({
      mode: 'redirect',
      payUrl: 'https://epay.example.com/pay/1',
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    const intent = await service.createIntent({
      orderId: ORDER_ID,
      userId: 'user_1',
      providerId: 'alipay',
    });

    expect(prisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: 'epay',
        providerMethod: 'alipay',
        providerConfigId: CONFIG_ID,
        providerConfigVersion: 3,
        providerInstanceId: 'default',
      }),
    });
    expect(adapterMock.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          providerId: 'epay',
          paymentMethod: 'alipay',
        }),
      }),
    );
    expect(intent.providerId).toBe('alipay');
    expect(intent.configId).toBe(CONFIG_ID);
  });

  it('渠道下单失败时归还已领取的负载均衡槽位', async () => {
    const { service, configs } = makeHarness();
    adapterMock.createOrder.mockRejectedValue(new Error('upstream unavailable'));

    await expect(
      service.createIntent({
        orderId: ORDER_ID,
        userId: 'user_1',
        providerId: 'alipay',
      }),
    ).rejects.toThrow(/发起支付失败/);

    expect(configs.reserveVisiblePaymentAttempt).toHaveBeenCalledOnce();
    expect(configs.releaseVisibleSelection).toHaveBeenCalledOnce();
  });

  it('订单写回因租约失效失败时归还负载均衡槽位', async () => {
    const { service, prisma, configs } = makeHarness(
      makeOrder({ payments: [] }),
    );
    prisma.order.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    adapterMock.createOrder.mockResolvedValue({
      mode: 'qrcode',
      codeUrl: 'https://qr.example.com/order_1',
      providerRef: 'sbx_old',
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    await expect(
      service.createIntent({
        orderId: ORDER_ID,
        userId: 'user_1',
        providerId: 'alipay',
      }),
    ).rejects.toThrow(/订单状态已变化/);

    expect(configs.releaseVisibleSelection).toHaveBeenCalledOnce();
  });

  it('另一笔支付正在发起时拒绝创建第二个渠道订单', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.createIntent({
        orderId: ORDER_ID,
        userId: 'user_1',
        providerId: 'alipay',
      }),
    ).rejects.toThrow(/正在发起另一笔支付/);

    expect(adapterMock.createOrder).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('订单正在关闭时拒绝发起支付', async () => {
    const { service, prisma, configs } = makeHarness(
      makeOrder({ closeStartedAt: new Date() }),
    );
    prisma.order.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.createIntent({
        orderId: ORDER_ID,
        userId: 'user_1',
        providerId: 'alipay',
      }),
    ).rejects.toThrow(/订单正在关闭/);

    expect(adapterMock.createOrder).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('租约过期被接管后，旧请求不会覆盖新 checkout', async () => {
    const { service, prisma } = makeHarness(
      makeOrder({ payments: [] }),
    );
    prisma.order.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    adapterMock.createOrder.mockResolvedValue({
      mode: 'qrcode',
      codeUrl: 'https://qr.example.com/order_1',
      providerRef: 'sbx_old',
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    await expect(
      service.createIntent({
        orderId: ORDER_ID,
        userId: 'user_1',
        providerId: 'alipay',
      }),
    ).rejects.toThrow(/订单状态已变化/);

    expect(prisma.order.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: ORDER_ID,
          status: 'pending',
          intentStartedAt: expect.any(Date),
        }),
      }),
    );
    expect(adapterMock.closeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ providerRef: 'sbx_old' }),
    );
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'pay_new', status: 'pending' },
      data: expect.objectContaining({ status: 'closed' }),
    });
  });

  it('真实渠道完成后回到原订单结算页，并带上主动查单标记', async () => {
    const { service } = makeHarness(
      makeOrder({
        channel: 'alipay',
        checkoutMode: 'redirect',
        items: [{ skuSnapshot: 'credits-100' }],
      }),
    );
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
    const { service, prisma } = makeHarness(
      makeOrder({
        channel: 'wechat',
        checkoutMode: 'redirect',
        items: [{ skuSnapshot: 'credits-100' }],
      }),
    );
    adapterMock.createOrder.mockResolvedValue({
      mode: 'redirect',
      payUrl: 'https://pay.example.com/cs_test_1',
      providerRef: 'cs_test_1',
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    await service.createIntent({ orderId: ORDER_ID, userId: 'user_1', providerId: 'wechat' });

    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay_new', status: 'pending' },
        data: { providerRef: 'cs_test_1' },
      }),
    );
  });

  it('把服务端提取的客户端 IP 原样传给渠道下单', async () => {
    const { service } = makeHarness(
      makeOrder({
        channel: 'wechat',
        checkoutMode: 'redirect',
        items: [{ skuSnapshot: 'credits-100' }],
      }),
    );
    adapterMock.createOrder.mockResolvedValue({
      mode: 'redirect',
      payUrl: 'https://pay.example.com/1',
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    await service.createIntent({
      orderId: ORDER_ID,
      userId: 'user_1',
      providerId: 'wechat',
      clientIp: '203.0.113.10',
    });

    expect(adapterMock.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ clientIp: '203.0.113.10' }),
    );
  });

  it('把支付宝移动端当面付开关透传并返回 Scheme，二维码优先落 checkoutValue', async () => {
    const { service, prisma, settings } = makeHarness(
      makeOrder({
        channel: 'alipay',
        checkoutMode: 'qrcode',
        items: [{ skuSnapshot: 'credits-100' }],
      }),
    );
    settings.paymentRules.mockResolvedValue(
      makePaymentRules({ alipayMobilePrecreateDeepLink: true }),
    );
    const codeUrl = 'https://qr.alipay.com/bax0000000000000001';
    adapterMock.createOrder.mockResolvedValue({
      mode: 'qrcode',
      codeUrl,
      payUrl: 'https://openapi.alipay.com/gateway.do?method=alipay.trade.page.pay',
      schemeUrl: `alipays://platformapi/startapp?saId=10000007&qrcode=${encodeURIComponent(codeUrl)}`,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    const intent = await service.createIntent({
      orderId: ORDER_ID,
      userId: 'user_1',
      providerId: 'alipay',
      clientUserAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148',
    });

    expect(adapterMock.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        alipayMobilePrecreateDeepLink: true,
        clientUserAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148',
      }),
    );
    expect(intent).toMatchObject({
      mode: 'qrcode',
      codeUrl,
      schemeUrl: `alipays://platformapi/startapp?saId=10000007&qrcode=${encodeURIComponent(codeUrl)}`,
      checkoutValue: codeUrl,
    });
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ checkoutValue: codeUrl }),
      }),
    );
  });

  it('后台开关关闭时向适配器明确透传 false', async () => {
    const { service } = makeHarness(
      makeOrder({
        channel: 'alipay',
        checkoutMode: 'redirect',
        items: [{ skuSnapshot: 'credits-100' }],
      }),
    );
    adapterMock.createOrder.mockResolvedValue({
      mode: 'redirect',
      payUrl: 'https://openapi.alipay.com/gateway.do?method=alipay.trade.wap.pay',
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    await service.createIntent({
      orderId: ORDER_ID,
      userId: 'user_1',
      providerId: 'alipay',
      clientUserAgent: 'Mozilla/5.0 (iPhone) Mobile',
    });

    expect(adapterMock.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ alipayMobilePrecreateDeepLink: false }),
    );
  });

  it('会员订单完成后回到会员结算页', async () => {
    const { service } = makeHarness(
      makeOrder({
        channel: 'alipay',
        checkoutMode: 'redirect',
        membershipPlanId: 'plan_1',
        items: [],
      }),
    );
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

  it('重新发起支付前先查单并关闭旧渠道尝试', async () => {
    const { service, prisma } = makeHarness(
      makeOrder({
        channel: 'wechat',
        checkoutMode: 'redirect',
        payments: [
          {
            id: 'pay_old',
            status: 'pending',
            channel: 'wechat',
            providerConfigId: CONFIG_ID,
            providerRef: 'cs_old',
            payTransactionId: null,
            amountCents: 1000,
            createdAt: new Date(),
          },
        ],
      }),
    );
    adapterMock.createOrder.mockResolvedValue({
      mode: 'redirect',
      payUrl: 'https://pay.example.com/cs_new',
      providerRef: 'cs_new',
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    await service.createIntent({ orderId: ORDER_ID, userId: 'user_1', providerId: 'wechat' });

    expect(adapterMock.queryOrder).toHaveBeenCalledWith(
      expect.objectContaining({ providerRef: 'cs_old' }),
    );
    expect(adapterMock.closeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ providerRef: 'cs_old' }),
    );
    expect(adapterMock.closeOrder.mock.invocationCallOrder[0]).toBeLessThan(
      adapterMock.createOrder.mock.invocationCallOrder[0],
    );
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'pay_old', status: 'pending' },
      data: expect.objectContaining({ status: 'closed' }),
    });
  });

  it('旧渠道尝试无法关闭时不创建新的支付单', async () => {
    const { service, prisma } = makeHarness(
      makeOrder({
        channel: 'wechat',
        checkoutMode: 'redirect',
        payments: [
          {
            id: 'pay_old',
            status: 'pending',
            channel: 'wechat',
            providerConfigId: CONFIG_ID,
            providerRef: 'cs_old',
            payTransactionId: null,
            amountCents: 1000,
            createdAt: new Date(),
          },
        ],
      }),
    );
    adapterMock.closeOrder.mockResolvedValue({
      state: 'failed',
      orderNo: 'HJ20261102120000ABC',
      error: 'close rejected',
      rawPayload: '',
    });

    await expect(
      service.createIntent({ orderId: ORDER_ID, userId: 'user_1', providerId: 'wechat' }),
    ).rejects.toThrow(/旧支付尝试无法关闭/);

    expect(adapterMock.createOrder).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.payment.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pay_old', status: 'pending' } }),
    );
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: ORDER_ID,
          intentStartedAt: expect.any(Date),
        }),
        data: expect.objectContaining({
          lastError: expect.stringContaining('旧支付尝试无法关闭'),
        }),
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
      'https://pay.example.com/api/v1/payment/webhook/alipay',
    );
  });

  it('未配置渠道地址时回落全局基址', () => {
    process.env.PAYMENT_NOTIFY_BASE = 'https://global.example.com';
    const { service } = makeHarness();
    expect(service.notifyUrl('wechat', 'cfg_2')).toBe(
      'https://global.example.com/api/v1/payment/webhook/wxpay',
    );
  });

  it('EasyPay / Stripe 使用规范路径，历史 configId 不进入 URL', () => {
    process.env.PAYMENT_NOTIFY_BASE = 'https://global.example.com';
    const { service } = makeHarness();
    expect(service.notifyUrl('epay', 'cfg_epay')).toBe(
      'https://global.example.com/api/v1/payment/webhook/easypay',
    );
    expect(service.notifyUrl('stripe', 'cfg_stripe')).toBe(
      'https://global.example.com/api/v1/payment/webhook/stripe',
    );
  });

  it('尚未迁移的渠道继续使用带 configId 的旧路径', () => {
    process.env.PAYMENT_NOTIFY_BASE = 'https://global.example.com';
    const { service } = makeHarness();
    expect(service.notifyUrl('zpay', 'cfg_zpay')).toBe(
      'https://global.example.com/api/v1/payments/callback/zpay/cfg_zpay',
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
