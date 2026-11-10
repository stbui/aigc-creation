import { describe, expect, it, vi } from 'vitest';
import { OrderService } from './order.service';

const CREDIT = 1_000_000n;

describe('OrderService.countUnreclaimableCredits', () => {
  it.each([
    {
      name: '未到期积分足够覆盖退款份额',
      lots: [{ id: 'lot-1', remainingMicrocredits: 100n * CREDIT, expireAt: future() }],
      expiredLedger: 0n,
      expected: 0,
    },
    {
      name: '过期但未消费的积分不算已消费',
      lots: [{ id: 'lot-1', remainingMicrocredits: 0n, expireAt: past() }],
      expiredLedger: -100n * CREDIT,
      expected: 0,
    },
    {
      name: '已消费和过期未用同时存在时只计算真实消费',
      lots: [{ id: 'lot-1', remainingMicrocredits: 0n, expireAt: past() }],
      expiredLedger: -60n * CREDIT,
      expected: 40,
    },
    {
      name: '可用积分不足时报告真实消费缺口',
      lots: [{ id: 'lot-1', remainingMicrocredits: 70n * CREDIT, expireAt: future() }],
      expiredLedger: 0n,
      expected: 30,
    },
  ])('$name', async ({ lots, expiredLedger, expected }) => {
    const prisma = {
      creditLot: { findMany: vi.fn().mockResolvedValue(lots) },
      creditLedgerEntry: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountMicrocredits: expiredLedger } }),
      },
    };
    const service = new OrderService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      (service as any).countUnreclaimableCredits('order-1', 100),
    ).resolves.toBe(expected);
  });
});

describe('OrderService.transition', () => {
  it('拒绝绕过支付关单直接取消订单', async () => {
    const prisma = {
      order: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };
    const service = new OrderService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.transition('order-1', 'cancelled')).rejects.toThrow(
      /必须走支付关单流程/,
    );
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });
});

describe('OrderService.cancelSandboxOrder', () => {
  it('同一事务关闭订单、pending 支付并释放库存占用', async () => {
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(prisma),
      ),
      $executeRaw: vi.fn().mockResolvedValue(1),
      order: {
        findUnique: vi.fn().mockResolvedValue({ status: 'pending' }),
        update: vi.fn().mockResolvedValue({}),
      },
      payment: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new OrderService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const release = vi
      .spyOn(service, 'releaseReservation')
      .mockResolvedValue(undefined);

    await expect((service as any).cancelSandboxOrder('order-1')).resolves.toBe(
      'cancelled',
    );

    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1', status: 'pending' },
      data: { status: 'closed', closedAt: expect.any(Date) },
    });
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        status: 'cancelled',
        closeStartedAt: null,
        intentStartedAt: null,
        checkoutValue: '',
      }),
    });
    expect(release).toHaveBeenCalledWith('order-1', prisma);
  });
});

describe('OrderService.refund 退款幂等与手工核销', () => {
  function makeRefundHarness(options: {
    channel?: string;
    latestFailed?: Record<string, unknown> | null;
    createdRefundId?: string;
  } = {}) {
    const payment = {
      id: 'payment-1',
      channel: options.channel ?? 'alipay',
      providerConfigId: 'payment-config',
      providerInstanceId: 'payment-instance',
      amountCents: 1000,
      providerRef: 'provider-ref',
      payTransactionId: 'trade-no',
    };
    const order = {
      id: 'order-1',
      orderNo: 'HJ001',
      userId: 'user-1',
      status: 'paid',
      paidCents: 1000,
      refundedCents: 0,
      currency: 'CNY',
      providerConfigId: 'order-config',
      providerInstanceId: 'order-instance',
    };
    const existingRefund = {
      id: 'refund-existing',
      orderId: order.id,
      paymentId: payment.id,
      status: 'processing',
      amountCents: 1000,
    };
    const createdRefund = {
      ...existingRefund,
      id: options.createdRefundId ?? 'refund-new',
    };
    const prisma: Record<string, any> = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn(async (work: (client: Record<string, any>) => unknown) =>
        work(prisma),
      ),
      order: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(order)
          .mockResolvedValueOnce({ ...order, payments: [payment], refunds: [] }),
      },
      refund: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(options.latestFailed ?? null),
        create: vi.fn().mockResolvedValue(createdRefund),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(existingRefund),
      },
    };
    const credit = { warnIncompleteReclaim: vi.fn() };
    const gateway = {
      refund: vi.fn().mockResolvedValue({ state: 'succeeded', raw: '{}' }),
    };
    const service = new OrderService(
      prisma as never,
      credit as never,
      {} as never,
      {} as never,
      {} as never,
      gateway as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service as any, 'assertRefundPolicy').mockResolvedValue({
      paidBase: 1000,
      refundable: 1000,
    });
    vi.spyOn(service as any, 'recordRefundSuccess').mockResolvedValue({
      refundId: existingRefund.id,
      state: 'succeeded',
      refundedCents: 1000,
      fullyRefunded: true,
      membershipTerminated: false,
      creditsReclaimed: 0,
      creditsUnreclaimable: 0,
      creditsExpired: 0,
      detail: [],
      invoiceFollowUp: null,
    });
    return { service, prisma, gateway, existingRefund, createdRefund, payment, order };
  }

  it('优先使用成功支付记录自身的 providerInstanceId', async () => {
    const { service, gateway } = makeRefundHarness();

    await service.refund({
      orderId: 'order-1',
      amountCents: 1000,
      reason: '用户申请退款',
      operatorId: 'admin-1',
    });

    expect(gateway.refund).toHaveBeenCalledWith(
      expect.objectContaining({
        order: {
          channel: 'alipay',
          providerConfigId: 'payment-config',
          providerInstanceId: 'payment-instance',
        },
      }),
    );
  });

  it('手工核销支付拒绝原路退款且不调用渠道、不创建退款单', async () => {
    const { service, prisma, gateway } = makeRefundHarness({ channel: 'manual' });

    await expect(
      service.refund({
        orderId: 'order-1',
        amountCents: 1000,
        reason: '用户申请退款',
        operatorId: 'admin-1',
      }),
    ).rejects.toThrow('手工核销订单没有真实渠道资金');

    expect(gateway.refund).not.toHaveBeenCalled();
    expect(prisma.refund.create).not.toHaveBeenCalled();
    expect(prisma.refund.updateMany).not.toHaveBeenCalled();
  });

  it('结果未知的失败退款重试复用原退款单号', async () => {
    const { service, prisma, gateway, existingRefund } = makeRefundHarness({
      latestFailed: {
        id: 'refund-existing',
        orderId: 'order-1',
        paymentId: 'payment-1',
        status: 'failed',
        amountCents: 1000,
        detail: JSON.stringify({ failureKind: 'unknown', error: 'network timeout' }),
      },
    });

    await service.refund({
      orderId: 'order-1',
      amountCents: 1000,
      reason: '网络异常后重试',
      operatorId: 'admin-1',
    });

    expect(prisma.refund.create).not.toHaveBeenCalled();
    expect(prisma.refund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: existingRefund.id, orderId: 'order-1', status: 'failed' } }),
    );
    expect(gateway.refund).toHaveBeenCalledWith(
      expect.objectContaining({ outRefundNo: existingRefund.id }),
    );
  });

  it('渠道明确拒绝后重试创建新退款单号', async () => {
    const { service, prisma, gateway, createdRefund } = makeRefundHarness({
      createdRefundId: 'refund-new',
      latestFailed: {
        id: 'refund-rejected',
        orderId: 'order-1',
        paymentId: 'payment-1',
        status: 'failed',
        amountCents: 1000,
        detail: JSON.stringify({ failureKind: 'definitive', error: '参数错误' }),
      },
    });

    await service.refund({
      orderId: 'order-1',
      amountCents: 1000,
      reason: '修正参数后重试',
      operatorId: 'admin-1',
    });

    expect(prisma.refund.create).toHaveBeenCalledOnce();
    expect(gateway.refund).toHaveBeenCalledWith(
      expect.objectContaining({ outRefundNo: createdRefund.id }),
    );
  });

  it('旧 failed 数据缺少 failureKind 时按结果未知复用原退款单号', async () => {
    const { service, prisma, gateway, existingRefund } = makeRefundHarness({
      latestFailed: {
        id: 'refund-existing',
        orderId: 'order-1',
        paymentId: 'payment-1',
        status: 'failed',
        amountCents: 1000,
        detail: JSON.stringify({ error: '历史网络异常' }),
      },
    });

    await service.refund({
      orderId: 'order-1',
      amountCents: 1000,
      reason: '历史失败重试',
      operatorId: 'admin-1',
    });

    expect(prisma.refund.create).not.toHaveBeenCalled();
    expect(gateway.refund).toHaveBeenCalledWith(
      expect.objectContaining({ outRefundNo: existingRefund.id }),
    );
  });
});

describe('OrderService.markPaid 用户锁', () => {
  it('入账事务首先锁定用户行，再读取/写订单与其他资源', async () => {
    const order = {
      id: 'order-1',
      orderNo: 'HJ001',
      userId: 'user-1',
      status: 'pending',
      paidCents: 100,
      currency: 'CNY',
      couponId: null,
      stockReserved: false,
      membershipPlanId: null,
      items: [],
    };
    const prisma: Record<string, any> = {
      payment: { findUnique: vi.fn().mockResolvedValue(null) },
      order: {
        findUnique: vi.fn().mockResolvedValue(order),
        updateMany: vi.fn().mockRejectedValue(new Error('stop-after-lock')),
      },
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    prisma.$transaction = vi.fn(
      async (work: (client: Record<string, any>) => unknown) => work(prisma),
    );
    const service = new OrderService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.markPaid({
        orderId: 'order-1',
        userId: 'user-1',
        payTransactionId: 'pay-1',
        channel: 'sandbox',
      }),
    ).rejects.toThrow('stop-after-lock');

    expect(prisma.order.updateMany).toHaveBeenCalledOnce();
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.order.updateMany.mock.invocationCallOrder[0],
    );
  });
});

describe('OrderService.markPaid 非成功交易号', () => {
  function makeHarness(paymentStatus: 'failed' | 'closed' | 'pending') {
    const order = {
      id: 'order-1',
      orderNo: 'HJ001',
      userId: 'user-1',
      status: 'pending',
      paidCents: 100,
      currency: 'CNY',
      couponId: null,
      stockReserved: false,
      membershipPlanId: null,
      providerConfigId: null,
      providerConfigVersion: null,
      providerInstanceId: null,
      items: [],
    };
    const existing = {
      id: 'payment-1',
      orderId: order.id,
      status: paymentStatus,
      payTransactionId: 'trade-1',
    };
    const prisma: Record<string, any> = {
      payment: {
        findUnique: vi.fn().mockResolvedValue(existing),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn(),
      },
      order: {
        findUnique: vi.fn().mockResolvedValue(order),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    prisma.$transaction = vi.fn(
      async (work: (client: Record<string, any>) => unknown) => work(prisma),
    );
    const marketing = {
      onOrderPaid: vi.fn().mockResolvedValue(undefined),
    };
    const notifications = {
      notify: vi.fn().mockResolvedValue(undefined),
    };
    const service = new OrderService(
      prisma as never,
      {} as never,
      marketing as never,
      {} as never,
      notifications as never,
      {} as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service, 'detail').mockResolvedValue({
      orderNo: 'HJ001',
      paidCents: 100,
      membershipPlanId: null,
      grantedCredits: 0,
    } as never);
    return { service, prisma, existing };
  }

  it('同一交易号的 failed 支付尝试可被迟到成功回调提升为 succeeded', async () => {
    const { service, prisma } = makeHarness('failed');

    await expect(
      service.markPaid({
        orderId: 'order-1',
        userId: 'user-1',
        payTransactionId: 'trade-1',
        channel: 'alipay',
        paymentId: 'payment-1',
      }),
    ).resolves.toMatchObject({ idempotentHit: false, message: '支付成功' });

    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'payment-1',
          orderId: 'order-1',
          status: { in: ['pending', 'failed', 'closed'] },
        },
        data: expect.objectContaining({ status: 'succeeded' }),
      }),
    );
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('同交易号已绑定另一支付尝试时拒绝静默改挂', async () => {
    const { service, prisma } = makeHarness('failed');

    await expect(
      service.markPaid({
        orderId: 'order-1',
        userId: 'user-1',
        payTransactionId: 'trade-1',
        channel: 'alipay',
        paymentId: 'payment-2',
      }),
    ).rejects.toThrow(/已绑定另一支付尝试/);

    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });
});

function future(): Date {
  return new Date(Date.now() + 24 * 3600 * 1000);
}

function past(): Date {
  return new Date(Date.now() - 24 * 3600 * 1000);
}
