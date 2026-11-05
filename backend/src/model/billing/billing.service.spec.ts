import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingService, isBillingOrderReviewable } from './billing.service';

describe('isBillingOrderReviewable', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z');

  it('任务失败且没有产物时，reserved 账单可核对', () => {
    expect(
      isBillingOrderReviewable(
        { status: 'reserved', updatedAt: new Date(now) },
        {
          status: 'failed',
          outputAssetId: null,
          pendingResult: null,
          mediaRecoveryError: '上游请求超时',
        },
        now,
      ),
    ).toBe(true);
  });

  it('已有产物时，uncertain 账单也不可核对', () => {
    expect(
      isBillingOrderReviewable(
        { status: 'uncertain', updatedAt: new Date(now) },
        {
          status: 'succeeded',
          outputAssetId: 'asset-1',
          pendingResult: null,
          mediaRecoveryError: null,
        },
        now,
      ),
    ).toBe(false);
  });

  it('仍在补交付时，超时 running 账单不可核对', () => {
    expect(
      isBillingOrderReviewable(
        { status: 'running', updatedAt: new Date(now - 41 * 60_000) },
        {
          status: 'running',
          outputAssetId: null,
          pendingResult: '{"result":{}}',
          mediaRecoveryError: '落盘重试中',
        },
        now,
      ),
    ).toBe(false);
  });
});

describe('BillingService 人工核对', () => {
  let tx: {
    billingOrder: {
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    generationTask: {
      findUnique: ReturnType<typeof vi.fn>;
    };
  };
  let prisma: { $transaction: ReturnType<typeof vi.fn> };
  let wallet: { settle: ReturnType<typeof vi.fn>; refund: ReturnType<typeof vi.fn> };
  let service: BillingService;

  beforeEach(() => {
    tx = {
      billingOrder: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      generationTask: {
        findUnique: vi.fn().mockResolvedValue({ status: 'failed' }),
      },
    };
    prisma = {
      $transaction: vi.fn(async (work: (client: unknown) => unknown) => work(tx)),
    };
    wallet = {
      settle: vi.fn().mockResolvedValue({}),
      refund: vi.fn().mockResolvedValue({}),
    };
    service = new BillingService(prisma as never, wallet as never);
  });

  it('退款与核对人标记在同一事务内完成', async () => {
    const order = {
      id: 'bill-1',
      status: 'uncertain',
      amountMicrocredits: 0n,
      userId: 'user-1',
      taskId: 'task-1',
      model: 'model-1',
      channelId: 'channel-1',
      scene: 'create',
    };
    const settled = { ...order, status: 'refunded', resolvedBy: 'admin-1', resolutionNote: 'confirmed' };
    tx.billingOrder.findUnique.mockResolvedValue(order);
    tx.billingOrder.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    const result = await service.resolve('bill-1', 'refund', 'admin-1', 'confirmed');

    expect(result).toBe(order);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.billingOrder.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { id: 'bill-1', status: { in: ['reserved', 'running', 'uncertain'] } } }),
    );
    expect(tx.billingOrder.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: {
          resolvedBy: 'admin-1',
          resolutionNote: 'confirmed',
          reviewBatchId: '',
        },
      }),
    );
    expect(settled).toBeTruthy();
  });

  it('结算路径也在同一事务内写终态与核对人', async () => {
    const order = {
      id: 'bill-2',
      status: 'uncertain',
      billingMode: 'token',
      amountMicrocredits: 0n,
      reservedAmountMicrocredits: 0n,
      actualAmountMicrocredits: 0n,
      quantity: 1n,
      userId: 'user-1',
      taskId: 'task-1',
      model: 'model-1',
      channelId: 'channel-1',
      scene: 'create',
      inputTokenPriceMicrocredits: 0n,
      outputTokenPriceMicrocredits: 0n,
      cachedTokenPriceMicrocredits: 0n,
      inputTokens: 0n,
      outputTokens: 0n,
      cachedTokens: 0n,
      usageAvailable: false,
      usageSource: '',
      providerRequestId: 'provider-1',
      chargeLimitSet: false,
      chargeLimitMicrocredits: 0n,
    };
    tx.billingOrder.findUnique.mockResolvedValue(order);
    tx.billingOrder.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    await service.resolve('bill-2', 'settle', 'admin-2', 'verified');

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(wallet.settle).toHaveBeenCalledOnce();
    expect(tx.billingOrder.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: {
          resolvedBy: 'admin-2',
          resolutionNote: 'verified',
          reviewBatchId: '',
        },
      }),
    );
  });
});
