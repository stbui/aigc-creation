import { describe, expect, it, vi } from 'vitest';
import { CreditService } from './credit.service';

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
