import { describe, expect, it, vi } from 'vitest';
import { OrderPaymentService } from './order-payment.service';

describe('OrderPaymentService.markPaid 用户锁', () => {
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
    prisma.$transaction = vi.fn(async (work: (client: Record<string, any>) => unknown) =>
      work(prisma),
    );
    const service = new OrderPaymentService(
      prisma as never,
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

describe('OrderPaymentService.markPaid 非成功交易号', () => {
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
    prisma.$transaction = vi.fn(async (work: (client: Record<string, any>) => unknown) =>
      work(prisma),
    );
    const marketing = {
      onOrderPaid: vi.fn().mockResolvedValue(undefined),
    };
    const notifications = {
      notify: vi.fn().mockResolvedValue(undefined),
    };
    const service = new OrderPaymentService(
      prisma as never,
      {} as never,
      marketing as never,
      {} as never,
      notifications as never,
    );
    vi.spyOn(service as any, 'viewOrder').mockResolvedValue({
      orderNo: 'HJ001',
      paidCents: 100,
      membershipPlanId: null,
      grantedCredits: 0,
    });
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
