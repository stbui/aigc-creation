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

describe('BillingService 多图融合部分交付结算', () => {
  it('请求 4 张只交付 1 张时只结算 1 张并退回其余预留', async () => {
    const order = {
      id: 'bill-fusion',
      status: 'running',
      billingMode: 'fixed_request',
      capability: 'multi_fusion',
      amountMicrocredits: 40_000_000n,
      reservedAmountMicrocredits: 40_000_000n,
      actualAmountMicrocredits: 40_000_000n,
      quantity: 4n,
      userId: 'user-1',
      taskId: 'task-1',
      model: 'model-1',
      channelId: 'channel-1',
      scene: 'print_pattern',
      unitPriceMicrocredits: 40_000_000n,
      multiplierBasisPoints: 10_000n,
      inputTokens: 0n,
      outputTokens: 0n,
      cachedTokens: 0n,
      usageSource: '',
      providerRequestId: null,
      chargeLimitSet: false,
      chargeLimitMicrocredits: 0n,
    };
    const settled = { ...order, status: 'settled' };
    const tx = {
      billingOrder: {
        findUnique: vi.fn().mockResolvedValueOnce(order).mockResolvedValueOnce(settled),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: unknown) => unknown) => work(tx)),
    };
    const wallet = {
      settle: vi.fn().mockResolvedValue({}),
      refund: vi.fn().mockResolvedValue({}),
    };
    const service = new BillingService(prisma as never, wallet as never, {} as never);

    await expect(service.settle('bill-fusion', { deliveredQuantity: 1 })).resolves.toBe(settled);

    expect(wallet.settle).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        reservedMicrocredits: 40_000_000n,
        actualMicrocredits: 10_000_000n,
        note: '按实际交付 1/4 张结算',
      }),
    );
    expect(tx.billingOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: 1n,
          actualAmountMicrocredits: 10_000_000n,
          refundedAmountMicrocredits: 30_000_000n,
        }),
      }),
    );
  });
});

describe('BillingService 限时免费结算', () => {
  /**
   * 准入只把金额置 0，单价快照保留。按秒 / Token 分支若不短路，
   * 结算会按实际用量重新算出正数金额，把已承诺的免费生成变成收费。
   */
  it('按秒计费订单命中限时免费时不再按实际时长扣费', async () => {
    const order = {
      id: 'bill-free-video',
      status: 'running',
      billingMode: 'per_second',
      capability: 'video',
      promotionId: 'campaign-free-1',
      amountMicrocredits: 0n,
      reservedAmountMicrocredits: 0n,
      actualAmountMicrocredits: 0n,
      quantity: 6n,
      unitPriceMicrocredits: 2_000_000n,
      multiplierBasisPoints: 10_000n,
      userId: 'user-1',
      taskId: 'task-1',
      model: 'video-model',
      channelId: 'channel-1',
      scene: 'image_to_video',
      usageSource: '',
      providerRequestId: null,
      chargeLimitSet: false,
      chargeLimitMicrocredits: 0n,
      inputTokens: 0n,
      outputTokens: 0n,
      cachedTokens: 0n,
    };
    const settled = { ...order, status: 'settled' };
    const tx = {
      billingOrder: {
        findUnique: vi.fn().mockResolvedValueOnce(order).mockResolvedValueOnce(settled),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: unknown) => unknown) => work(tx)),
    };
    const wallet = {
      settle: vi.fn().mockResolvedValue({}),
      refund: vi.fn().mockResolvedValue({}),
    };
    const service = new BillingService(prisma as never, wallet as never, {} as never);

    await service.settle('bill-free-video', { audioDurationMs: 6_000 });

    expect(wallet.settle).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        reservedMicrocredits: 0n,
        actualMicrocredits: 0n,
        note: '限时免费活动生效，按 0 积分结算',
      }),
    );
    expect(tx.billingOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actualAmountMicrocredits: 0n,
          refundedAmountMicrocredits: 0n,
        }),
      }),
    );
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
    service = new BillingService(prisma as never, wallet as never, {} as never);
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

describe('BillingService 换线账单原子替换', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const oldOrder = {
    id: 'bill-old',
    userId: 'user-1',
    taskId: 'task-1',
    status: 'running',
    amountMicrocredits: 5_000_000n,
    reservedAmountMicrocredits: 5_000_000n,
    model: 'old-model',
    channelId: 'old-channel',
    scene: 'create',
    createdAt: now,
    updatedAt: now,
  };
  const newOrder = { ...oldOrder, id: 'bill-new', status: 'reserved', model: 'new-model' };
  const draft = {
    model: 'new-model',
    capability: 'image',
    scene: 'create',
    billingMode: 'fixed_request',
    channelId: 'new-channel',
    channelModelId: 'new-channel-model',
    priceTierId: '',
    priceTierVersion: 0,
    priceSelectorJson: '{}',
    priceVersion: 1,
    unitPriceMicrocredits: 5_000_000n,
    multiplierBasisPoints: 10_000n,
    userGroup: 'default',
    priceCurrency: 'credits',
    currencyRateMicrocredits: 1_000_000n,
    quantity: 1n,
    amountMicrocredits: 5_000_000n,
    inputTokenPriceMicrocredits: 0n,
    outputTokenPriceMicrocredits: 0n,
    cachedTokenPriceMicrocredits: 0n,
    inputTokens: 0n,
    outputTokens: 0n,
    cachedTokens: 0n,
    videoFormulaTokens: 0n,
    costConfigured: false,
    costUnitPriceMicrocredits: 0n,
    costInputTokenPriceMicrocredits: 0n,
    costOutputTokenPriceMicrocredits: 0n,
    costCachedTokenPriceMicrocredits: 0n,
    costBillingMode: '',
    costQuantity: 0n,
    costVideoFormulaTokens: 0n,
  };

  function setup(options: { oldStatus?: string; oldUserId?: string; taskCasCount?: number } = {}) {
    const refunded = { ...oldOrder, status: 'refunded' };
    const tx = {
      generationTask: {
        findUnique: vi.fn().mockResolvedValue({
          ownerId: 'user-1',
          billingOrderId: 'bill-old',
          status: 'running',
          leaseOwner: 'worker-1',
        }),
        updateMany: vi.fn().mockResolvedValue({ count: options.taskCasCount ?? 1 }),
      },
      billingOrder: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ ...oldOrder, status: options.oldStatus ?? 'running', userId: options.oldUserId ?? 'user-1' })
          .mockResolvedValueOnce(refunded),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue(newOrder),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    };
    const wallet = {
      settle: vi.fn(),
      refund: vi.fn().mockResolvedValue({ balance: {} }),
      reserve: vi.fn().mockResolvedValue({ balance: {} }),
    };
    const service = new BillingService(prisma as never, wallet as never, {} as never);
    return { service, prisma, tx, wallet };
  }

  function params(afterSwap = vi.fn().mockResolvedValue(undefined)) {
    return {
      userId: 'user-1',
      taskId: 'task-1',
      expectedBillingOrderId: 'bill-old',
      expectedLeaseOwner: 'worker-1',
      idempotencyKey: 'task:task-1:run1:attempt2',
      draft: draft as never,
      chargeLimitMicrocredits: 5_000_000n,
      afterSwap,
    };
  }

  it('旧退款、新预留、任务 CAS 和 attempt 回调在同一事务内完成', async () => {
    const { service, prisma, wallet, tx } = setup();
    const afterSwap = vi.fn().mockResolvedValue(undefined);

    await expect(service.replaceTaskBilling(params(afterSwap))).resolves.toMatchObject({ order: newOrder });

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(wallet.refund).toHaveBeenCalledOnce();
    expect(wallet.reserve).toHaveBeenCalledOnce();
    expect(wallet.refund.mock.invocationCallOrder[0]).toBeLessThan(wallet.reserve.mock.invocationCallOrder[0]);
    expect(tx.generationTask.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ billingOrderId: 'bill-old', leaseOwner: 'worker-1' }),
        data: expect.objectContaining({ billingOrderId: 'bill-new', creditCost: 5 }),
      }),
    );
    expect(afterSwap).toHaveBeenCalledOnce();
  });

  it('换线后的新账单保留限时活动归属', async () => {
    const { service, tx } = setup();
    const withPromotion = { ...params(), promotionId: 'campaign-free-1' };

    await expect(service.replaceTaskBilling(withPromotion)).resolves.toMatchObject({ order: newOrder });

    expect(tx.billingOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ promotionId: 'campaign-free-1' }),
      }),
    );
  });

  it('旧账单退款失败时不创建新账单', async () => {
    const { service, wallet, tx } = setup();
    wallet.refund.mockRejectedValueOnce(new Error('wallet broken'));

    await expect(service.replaceTaskBilling(params())).rejects.toThrow('wallet broken');

    expect(tx.billingOrder.create).not.toHaveBeenCalled();
    expect(wallet.reserve).not.toHaveBeenCalled();
    expect(tx.generationTask.updateMany).not.toHaveBeenCalled();
  });

  it('任务账单 CAS 失败时抛冲突且不执行 attempt 回调', async () => {
    const { service, wallet } = setup({ taskCasCount: 0 });
    const afterSwap = vi.fn().mockResolvedValue(undefined);

    await expect(service.replaceTaskBilling(params(afterSwap))).rejects.toMatchObject({ code: 40900 });

    expect(wallet.refund).toHaveBeenCalledOnce();
    expect(wallet.reserve).toHaveBeenCalledOnce();
    expect(afterSwap).not.toHaveBeenCalled();
  });

  it('旧账单不属于当前用户时拒绝替换且不动钱包', async () => {
    const { service, wallet, tx } = setup({ oldUserId: 'user-2' });

    await expect(service.replaceTaskBilling(params())).rejects.toMatchObject({ code: 40900 });

    expect(wallet.refund).not.toHaveBeenCalled();
    expect(tx.billingOrder.create).not.toHaveBeenCalled();
  });

  it('旧账单已结算时拒绝替换且不动钱包', async () => {
    const { service, wallet, tx } = setup({ oldStatus: 'settled' });

    await expect(service.replaceTaskBilling(params())).rejects.toMatchObject({ code: 40909 });

    expect(wallet.refund).not.toHaveBeenCalled();
    expect(tx.billingOrder.create).not.toHaveBeenCalled();
  });
});
