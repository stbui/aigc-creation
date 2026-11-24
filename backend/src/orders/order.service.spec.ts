import { describe, expect, it, vi } from 'vitest';
import { OrderService } from './order.service';

function newService(prisma: unknown) {
  return new OrderService(prisma as never, {} as never, {} as never, {} as never, {} as never);
}

describe('OrderService.transition', () => {
  it('拒绝绕过支付关单直接取消订单', async () => {
    const prisma = {
      order: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };
    const service = newService(prisma);

    await expect(service.transition('order-1', 'cancelled')).rejects.toThrow(/必须走支付关单流程/);
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });
});

describe('OrderService.cancelSandboxOrder', () => {
  it('同一事务关闭订单、pending 支付并释放库存占用', async () => {
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
      $executeRaw: vi.fn().mockResolvedValue(1),
      order: {
        findUnique: vi.fn().mockResolvedValue({ status: 'pending' }),
        update: vi.fn().mockResolvedValue({}),
      },
      payment: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = newService(prisma);
    const release = vi.spyOn(service, 'releaseReservation').mockResolvedValue(undefined);

    await expect((service as any).cancelSandboxOrder('order-1')).resolves.toBe('cancelled');

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
