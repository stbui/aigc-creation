import { describe, expect, it, vi } from 'vitest';
import { OrderRefundService } from './order-refund.service';
import { OrderRefundPolicyService } from './order-refund-policy.service';

const CREDIT = 1_000_000n;

describe('OrderRefundPolicyService.countUnreclaimableCredits', () => {
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
    const service = new OrderRefundPolicyService(prisma as never);

    await expect((service as any).countUnreclaimableCredits('order-1', 100)).resolves.toBe(
      expected,
    );
  });
});

describe('OrderRefundService.refund 退款幂等与手工核销', () => {
  function makeRefundHarness(
    options: {
      channel?: string;
      latestFailed?: Record<string, unknown> | null;
      createdRefundId?: string;
    } = {},
  ) {
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
      $transaction: vi.fn(async (work: (client: Record<string, any>) => unknown) => work(prisma)),
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
    const policy = {
      assertRefundPolicy: vi.fn().mockResolvedValue({
        paidBase: 1000,
        refundable: 1000,
      }),
    };
    const service = new OrderRefundService(
      prisma as never,
      credit as never,
      {} as never,
      gateway as never,
      {} as never,
      policy as never,
    );
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
      expect.objectContaining({
        where: { id: existingRefund.id, orderId: 'order-1', status: 'failed' },
      }),
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

function future(): Date {
  return new Date(Date.now() + 24 * 3600 * 1000);
}

function past(): Date {
  return new Date(Date.now() - 24 * 3600 * 1000);
}
