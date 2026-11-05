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

function future(): Date {
  return new Date(Date.now() + 24 * 3600 * 1000);
}

function past(): Date {
  return new Date(Date.now() - 24 * 3600 * 1000);
}
