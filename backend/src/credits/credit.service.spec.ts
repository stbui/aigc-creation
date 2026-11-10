import { describe, expect, it, vi } from 'vitest';
import { CreditService, emptyBalanceSummary } from './credit.service';

describe('CreditService 积分查询口径', () => {
  it('批量汇总余额时排除过期批次，并按正向流水计算累计获得', async () => {
    const nearestExpiry = new Date('2026-12-01T00:00:00.000Z');
    const prisma = {
      creditAccount: {
        findMany: vi.fn().mockResolvedValue([
          { userId: 'u1', availableMicrocredits: 12_000_000n },
        ]),
      },
      creditLot: {
        groupBy: vi
          .fn()
          .mockResolvedValueOnce([
            { userId: 'u1', _count: { _all: 2 }, _min: { expireAt: nearestExpiry } },
          ])
          .mockResolvedValueOnce([
            { userId: 'u1', _sum: { remainingMicrocredits: 3_000_000n } },
          ]),
      },
      creditLedgerEntry: {
        groupBy: vi
          .fn()
          .mockResolvedValueOnce([
            { userId: 'u1', _sum: { amountMicrocredits: 20_000_000n } },
          ])
          .mockResolvedValueOnce([
            { userId: 'u1', _sum: { amountMicrocredits: -5_000_000n } },
          ]),
      },
    };
    const service = new CreditService(prisma as never, {} as never);

    const summaries = await service.balancesOf(['u1', 'u1', 'u2', '']);

    expect(summaries.get('u1')).toEqual({
      balance: 12,
      expiringSoon: 3,
      totalEarned: 20,
      totalConsumed: 5,
      activeLots: 2,
      nearestExpiry: nearestExpiry.toISOString(),
    });
    expect(summaries.get('u2')).toEqual({
      balance: 0,
      expiringSoon: 0,
      totalEarned: 0,
      totalConsumed: 0,
      activeLots: 0,
      nearestExpiry: null,
    });

    expect(prisma.creditLot.groupBy.mock.calls[0][0]).toMatchObject({
      by: ['userId'],
      where: {
        userId: { in: ['u1', 'u2'] },
        remainingMicrocredits: { gt: 0n },
        OR: [{ expireAt: null }, { expireAt: { gt: expect.any(Date) } }],
      },
      _count: { _all: true },
      _min: { expireAt: true },
    });

    const expiringWhere = prisma.creditLot.groupBy.mock.calls[1][0].where;
    expect(expiringWhere.expireAt.gt).toBeInstanceOf(Date);
    expect(expiringWhere.expireAt.lte).toBeInstanceOf(Date);
    expect(expiringWhere.expireAt.lte.getTime() - expiringWhere.expireAt.gt.getTime()).toBe(
      30 * 24 * 3600 * 1000,
    );

    // admin_adjust 同时承载增减，累计获得只能汇总正数，避免负向客服扣减冲减历史获得。
    expect(prisma.creditLedgerEntry.groupBy.mock.calls[0][0]).toMatchObject({
      by: ['userId'],
      where: {
        userId: { in: ['u1', 'u2'] },
        type: { in: ['purchase', 'grant', 'admin_adjust'] },
        amountMicrocredits: { gt: 0n },
      },
      _sum: { amountMicrocredits: true },
    });
  });

  it('可用批次查询同时排除零余额和已过期批次', async () => {
    const prisma = {
      creditLot: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new CreditService(prisma as never, {} as never);

    await service.lotsOf('u1', false);

    expect(prisma.creditLot.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        remainingMicrocredits: { gt: 0n },
        OR: [{ expireAt: null }, { expireAt: { gt: expect.any(Date) } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  it('流水按方向筛选时使用金额正负号，并与类型筛选组合', async () => {
    const prisma = {
      creditLedgerEntry: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    const service = new CreditService(prisma as never, {} as never);

    await service.ledgerOf('u1', 20, { type: 'admin_adjust', direction: 'expense' });

    expect(prisma.creditLedgerEntry.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        type: 'admin_adjust',
        amountMicrocredits: { lt: 0n },
      },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
  });

  it.each([
    [{ type: 'reserve' }, '未知积分流水类型'],
    [{ direction: 'sideways' as never }, '未知积分流水方向'],
  ])('非法筛选参数返回 40001: %s', async (options, message) => {
    const prisma = {
      creditLedgerEntry: {
        findMany: vi.fn(),
        count: vi.fn(),
      },
    };
    const service = new CreditService(prisma as never, {} as never);

    await expect(service.ledgerOf('u1', 20, options)).rejects.toMatchObject({
      code: 40001,
      message: expect.stringContaining(message),
    });
    expect(prisma.creditLedgerEntry.findMany).not.toHaveBeenCalled();
  });
});

describe('CreditService 退款扣回只使用本单批次', () => {
  /**
   * 回归：退款只能扣本单产生的批次。本单积分已消耗时，缺口必须如实记为
   * 不可回收，不能继续扣用户另一笔订单的积分。
   */
  it('只扣本单批次，缺口记为不可回收而不挪用其它订单积分', async () => {
    const taken: Array<{ id: string; micro: bigint }> = [];
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({ userId: 'u1', grantedCredits: 100 }),
      },
      creditLot: {
        findMany: vi
          .fn()
          // 本单批次只剩 60；用户另有 500 积分也不得被本单退款挪用。
          .mockResolvedValueOnce([{ id: 'own-1', remainingMicrocredits: 60_000_000n }])
          .mockResolvedValueOnce([]),
        updateMany: vi.fn().mockImplementation(({ where, data }) => {
          taken.push({ id: where.id, micro: data.remainingMicrocredits.decrement });
          return { count: 1 };
        }),
      },
      creditLedgerEntry: { create: vi.fn().mockResolvedValue({}) },
    };
    const wallet = {
      debitAccountOnly: vi.fn().mockResolvedValue({
        availableMicrocredits: 400_000_000n,
        reservedMicrocredits: 0n,
      }),
    };
    const prisma = {
      order: tx.order,
      $transaction: vi.fn().mockImplementation((fn: never) => (fn as never as Function)(tx)),
    };
    const service = new CreditService(prisma as never, wallet as never);

    const result = await service.reclaimForOrder('o-1', 'admin', '退款');

    expect(taken).toEqual([{ id: 'own-1', micro: 60_000_000n }]);
    expect(result.reclaimed).toBe(60);
    expect(result.unreclaimable).toBe(40);
    expect(result.expiredUnused).toBe(0);
    expect(tx.creditLot.findMany).toHaveBeenCalledTimes(2);
    expect(tx.creditLot.findMany.mock.calls[0][0].where).toMatchObject({ orderId: 'o-1' });
  });

  it('本单未过期批次不足时，把已过期未使用份额单独归类', async () => {
    const taken: Array<{ id: string; micro: bigint }> = [];
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({ userId: 'u1', grantedCredits: 100 }),
      },
      creditLot: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: 'active-1', remainingMicrocredits: 60_000_000n }])
          .mockResolvedValueOnce([{ id: 'expired-1', remainingMicrocredits: 30_000_000n }]),
        updateMany: vi.fn().mockImplementation(({ where, data }) => {
          taken.push({ id: where.id, micro: data.remainingMicrocredits.decrement });
          return { count: 1 };
        }),
      },
      creditLedgerEntry: { create: vi.fn().mockResolvedValue({}) },
    };
    const wallet = {
      debitAccountOnly: vi.fn().mockResolvedValue({
        availableMicrocredits: 400_000_000n,
        reservedMicrocredits: 0n,
      }),
    };
    const prisma = {
      order: tx.order,
      $transaction: vi.fn().mockImplementation((fn: never) => (fn as never as Function)(tx)),
    };
    const service = new CreditService(prisma as never, wallet as never);

    const result = await service.reclaimForOrder('o-1', 'admin', '退款');

    expect(taken).toEqual([{ id: 'active-1', micro: 60_000_000n }]);
    expect(result).toMatchObject({ reclaimed: 60, expiredUnused: 30, unreclaimable: 10 });
    // 过期批次只做事实分类，不扣批次、不写流水，避免把已作废积分重复扣一次。
    expect(tx.creditLot.updateMany).toHaveBeenCalledTimes(1);
    expect(wallet.debitAccountOnly).toHaveBeenCalledWith(tx, 'u1', 60_000_000n);
  });

  it('本单批次足够时只扣本单批次', async () => {
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({ userId: 'u1', grantedCredits: 50 }),
      },
      creditLot: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: 'own-1', remainingMicrocredits: 80_000_000n }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      creditLedgerEntry: { create: vi.fn().mockResolvedValue({}) },
    };
    const wallet = {
      debitAccountOnly: vi.fn().mockResolvedValue({
        availableMicrocredits: 450_000_000n,
        reservedMicrocredits: 0n,
      }),
    };
    const prisma = {
      order: tx.order,
      $transaction: vi.fn().mockImplementation((fn: never) => (fn as never as Function)(tx)),
    };
    const service = new CreditService(prisma as never, wallet as never);

    await service.reclaimForOrder('o-1', 'admin', '退款');

    expect(tx.creditLot.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.creditLot.updateMany.mock.calls[0][0].where.id).toBe('own-1');
  });
});

describe('CreditService 人工调整幂等', () => {
  it('同一幂等键重复追加不二次发放', async () => {
    const existing: Array<{ referenceKey: string; userId: string }> = [];
    const created: Array<{ amountMicrocredits: bigint }> = [];
    const tx = {
      creditLedgerEntry: {
        findUnique: vi.fn().mockImplementation(({ where }) => {
          const hit = existing.find((e) => e.referenceKey === where.referenceKey);
          return hit ? { userId: hit.userId } : null;
        }),
        create: vi.fn().mockImplementation(({ data }) => {
          created.push({ amountMicrocredits: data.amountMicrocredits });
          if (data.referenceKey) {
            existing.push({ referenceKey: data.referenceKey, userId: data.userId });
          }
          return {};
        }),
      },
      creditLot: { create: vi.fn().mockResolvedValue({ id: 'lot-1' }) },
      creditAccount: {
        findUnique: vi.fn().mockResolvedValue({ userId: 'u1' }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({
          availableMicrocredits: 100_000_000n,
          reservedMicrocredits: 0n,
        }),
      },
    };
    const wallet = {
      balanceOf: vi.fn().mockResolvedValue({
        availableMicrocredits: 100_000_000n,
        reservedMicrocredits: 0n,
      }),
      grant: vi.fn().mockImplementation((_db: unknown, params: { amountMicrocredits: bigint; meta: { referenceKey?: string } }) => {
        created.push({ amountMicrocredits: params.amountMicrocredits });
        if (params.meta?.referenceKey) {
          existing.push({ referenceKey: params.meta.referenceKey, userId: 'u1' });
        }
        return {
          lotId: 'lot-1',
          balance: { availableMicrocredits: 100_000_000n, reservedMicrocredits: 0n },
        };
      }),
    };
    const prisma = {
      // adminAdjust 末尾要读余额概览
      creditAccount: {
        findMany: vi.fn().mockResolvedValue([
          { userId: 'u1', availableMicrocredits: 100_000_000n },
        ]),
      },
      creditLot: { groupBy: vi.fn().mockResolvedValue([]) },
      creditLedgerEntry: {
        groupBy: vi.fn().mockResolvedValue([]),
        findUnique: tx.creditLedgerEntry.findUnique,
        create: tx.creditLedgerEntry.create,
      },
      $transaction: vi.fn().mockImplementation((fn: never) => (fn as never as Function)(tx)),
    };
    const service = new CreditService(prisma as never, wallet as never);

    const first = await service.adminAdjust({
      userId: 'u1',
      delta: 100,
      reason: '活动补偿',
      operatorId: 'admin',
      idempotencyKey: 'batch:admin:key-1:0',
    });
    const second = await service.adminAdjust({
      userId: 'u1',
      delta: 100,
      reason: '活动补偿',
      operatorId: 'admin',
      idempotencyKey: 'batch:admin:key-1:0',
    });

    expect(first.idempotentHit).toBe(false);
    expect(second.idempotentHit).toBe(true);
    // 只发了一次
    expect(created).toHaveLength(1);
  });

  it('未填写备注时使用系统说明继续调整', async () => {
    const service = new CreditService({} as never, {} as never);
    const grant = vi.spyOn(service, 'grant').mockResolvedValue({
      lotId: 'lot-1',
      balance: 10,
    });
    vi.spyOn(service, 'balanceOf').mockResolvedValue({
      ...emptyBalanceSummary(),
      balance: 10,
    });

    const result = await service.adminAdjust({
      userId: 'u1',
      delta: 10,
      reason: '   ',
      operatorId: 'admin',
    });

    expect(result).toEqual({ balance: 10, idempotentHit: false });
    expect(grant).toHaveBeenCalledWith(
      expect.objectContaining({ reason: '人工增加积分（系统自动记录）' }),
    );
  });
});

describe('CreditService 并发幂等', () => {
  /**
   * 两个请求同时通过「先查后写」时，由 referenceKey 唯一约束裁决。
   * 输家的事务已整体回滚，必须回查赢家流水并按幂等命中返回，
   * 不能把一次并发重试变成 P2002 失败。
   */
  function concurrentSetup() {
    const winner = { userId: 'u1' };
    const prisma = {
      $transaction: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })),
      creditLedgerEntry: { findUnique: vi.fn().mockResolvedValue(winner) },
    };
    const wallet = {
      balanceOf: vi.fn().mockResolvedValue({
        availableMicrocredits: 100_000_000n,
        reservedMicrocredits: 0n,
      }),
    };
    return { prisma, wallet };
  }

  it('grant 同键并发冲突后按幂等命中返回', async () => {
    const { prisma, wallet } = concurrentSetup();
    const service = new CreditService(prisma as never, wallet as never);

    await expect(
      service.grant({ userId: 'u1', credits: 10, source: 'grant', idempotencyKey: 'k1' }),
    ).resolves.toEqual({ lotId: '', balance: 100, idempotentHit: true });
    expect(prisma.creditLedgerEntry.findUnique).toHaveBeenCalledWith({
      where: { referenceKey: 'credit-grant:k1' },
      select: { userId: true },
    });
  });

  it('consume 同键并发冲突后按幂等命中返回', async () => {
    const { prisma, wallet } = concurrentSetup();
    const service = new CreditService(prisma as never, wallet as never);

    await expect(
      service.consume({ userId: 'u1', credits: 10, idempotencyKey: 'k2' }),
    ).resolves.toEqual({ consumed: 0, balance: 100, lotId: null });
    expect(prisma.creditLedgerEntry.findUnique).toHaveBeenCalledWith({
      where: { referenceKey: 'credit-consume:k2' },
      select: { userId: true },
    });
  });

  it('非唯一约束错误原样上抛', async () => {
    const { prisma, wallet } = concurrentSetup();
    prisma.$transaction.mockRejectedValueOnce(new Error('database is locked'));
    const service = new CreditService(prisma as never, wallet as never);

    await expect(
      service.grant({ userId: 'u1', credits: 10, source: 'grant', idempotencyKey: 'k3' }),
    ).rejects.toThrow('database is locked');
    expect(prisma.creditLedgerEntry.findUnique).not.toHaveBeenCalled();
  });
});

describe('CreditService 账实核对', () => {
  /**
   * 等式是「可用 == Σ 批次剩余」，冻结量不参与。
   * 预留是「可用 -X、冻结 +X，同时批次 -X」——已冻结的积分在预留时就离开了
   * 批次，把它重新加回等式会把所有有预授权的用户全判成不一致。
   */
  it('预留中的账户不应被判为不一致', async () => {
    const prisma = {
      creditAccount: {
        // 冻结量只在账户行上存在；核对不得把它加进等式（否则 expected=100）。
        findMany: vi.fn().mockResolvedValue([
          { userId: 'u1', availableMicrocredits: 60_000_000n, reservedMicrocredits: 40_000_000n },
        ]),
      },
      creditLot: {
        groupBy: vi.fn().mockResolvedValue([{ userId: 'u1', _sum: { remainingMicrocredits: 60_000_000n } }]),
      },
    };
    const service = new CreditService(prisma as never, {} as never);

    const result = await service.auditConsistency();

    expect(result.checked).toBe(1);
    expect(result.mismatched).toEqual([]);
  });

  it('批次总额与账户不符时报出差额', async () => {
    const prisma = {
      creditAccount: {
        findMany: vi.fn().mockResolvedValue([{ userId: 'u1', availableMicrocredits: 100_000_000n }]),
      },
      creditLot: {
        groupBy: vi.fn().mockResolvedValue([{ userId: 'u1', _sum: { remainingMicrocredits: 70_000_000n } }]),
      },
    };
    const service = new CreditService(prisma as never, {} as never);

    const result = await service.auditConsistency();

    // 账户 100，批次只有 70 —— 少了 30，差额为负（批次比账户少）
    expect(result.mismatched).toEqual([
      { userId: 'u1', accountAvailable: 100, lotsRemaining: 70, diff: -30 },
    ]);
  });

  it('按 userId 游标翻页扫描全部账户，而不是只扫第一页', async () => {
    const prisma = {
      creditAccount: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            { userId: 'u1', availableMicrocredits: 10_000_000n },
            { userId: 'u2', availableMicrocredits: 20_000_000n },
          ])
          .mockResolvedValueOnce([{ userId: 'u3', availableMicrocredits: 30_000_000n }]),
      },
      creditLot: {
        groupBy: vi.fn().mockResolvedValue([
          { userId: 'u1', _sum: { remainingMicrocredits: 10_000_000n } },
          { userId: 'u2', _sum: { remainingMicrocredits: 20_000_000n } },
          { userId: 'u3', _sum: { remainingMicrocredits: 30_000_000n } },
        ]),
      },
    };
    const service = new CreditService(prisma as never, {} as never);

    const result = await service.auditConsistency(2);

    expect(result.checked).toBe(3);
    expect(result.mismatched).toEqual([]);
    expect(prisma.creditAccount.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ take: 2, orderBy: { userId: 'asc' } }),
    );
    expect(prisma.creditAccount.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        take: 2,
        orderBy: { userId: 'asc' },
        cursor: { userId: 'u2' },
        skip: 1,
      }),
    );
    expect(prisma.creditLot.groupBy).toHaveBeenCalledWith({
      by: ['userId'],
      where: { remainingMicrocredits: { gt: 0n } },
      _sum: { remainingMicrocredits: true },
    });
  });

  it('批次仍有余量但账户不存在时报告孤儿批次', async () => {
    const prisma = {
      creditAccount: {
        findMany: vi.fn().mockResolvedValue([
          { userId: 'u1', availableMicrocredits: 10_000_000n },
        ]),
      },
      creditLot: {
        groupBy: vi.fn().mockResolvedValue([
          { userId: 'u1', _sum: { remainingMicrocredits: 10_000_000n } },
          { userId: 'orphan', _sum: { remainingMicrocredits: 7_000_000n } },
        ]),
      },
    };
    const service = new CreditService(prisma as never, {} as never);

    const result = await service.auditConsistency();

    expect(result.orphanLots).toEqual([{ userId: 'orphan', lotsRemaining: 7 }]);
    expect(result.orphanLotCount).toBe(1);
    expect(result.mismatched).toEqual([]);
  });
});
