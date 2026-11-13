import { describe, expect, it, vi } from 'vitest';
import { MembershipService } from './membership.service';

describe('MembershipService.subscribe', () => {
  it('先锁用户再抢订单闸门和读取会员投影', async () => {
    const tx: any = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      order: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
      },
      membership: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'membership-1' }),
      },
    };
    const prisma: any = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'order-1',
          userId: 'user-1',
          status: 'paid',
          membershipPlanId: 'plan-1',
          membershipPerksSnapshot: '{}',
          membershipMonthlyCreditsSnapshot: 0,
          membershipDurationDaysSnapshot: 30,
          membershipUserGroupCodeSnapshot: 'member',
          orderNo: 'ORDER-1',
        }),
      },
      membershipPlan: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'plan-1',
          code: 'PRO',
          name: '专业会员',
          durationDays: 30,
          monthlyCredits: 0,
          perks: '{}',
          userGroupCode: 'member',
        }),
      },
      $transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const groups = { invalidate: vi.fn() };
    const catalogVersion = { invalidate: vi.fn().mockResolvedValue(undefined) };
    const service = new MembershipService(
      prisma as never,
      { grant: vi.fn() } as never,
      {} as never,
      groups as never,
      catalogVersion as never,
    );

    await expect(
      service.subscribe({ userId: 'user-1', planId: 'plan-1', orderId: 'order-1' }),
    ).resolves.toMatchObject({
      membershipId: 'membership-1',
      planCode: 'PRO',
      alreadyApplied: false,
    });

    const lockOrder = tx.$executeRaw.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(tx.order.updateMany.mock.invocationCallOrder[0]);
    expect(lockOrder).toBeLessThan(tx.membership.findFirst.mock.invocationCallOrder[0]);
    expect(groups.invalidate).toHaveBeenCalledOnce();
    expect(catalogVersion.invalidate).toHaveBeenCalledOnce();
  });
});

describe('MembershipService.historyOf', () => {
  const createService = (prisma: any) =>
    new MembershipService(
      prisma,
      { grant: vi.fn() } as never,
      {} as never,
      { invalidate: vi.fn() } as never,
      { invalidate: vi.fn() } as never,
    );

  it('按订单周期快照还原历史，并区分待生效、生效中、已过期和已退款', async () => {
    const now = Date.now();
    const prisma: any = {
      order: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'order-active',
            status: 'paid',
            membershipPeriodStartAt: new Date(now - 24 * 3600 * 1000),
            membershipPeriodEndAt: new Date(now + 24 * 3600 * 1000),
            membershipPeriodRevokedAt: null,
            membershipMonthlyCreditsSnapshot: 500,
            membershipPlan: { code: 'PRO', name: '专业会员' },
          },
          {
            id: 'order-scheduled',
            status: 'paid',
            membershipPeriodStartAt: new Date(now + 24 * 3600 * 1000),
            membershipPeriodEndAt: new Date(now + 48 * 3600 * 1000),
            membershipPeriodRevokedAt: null,
            membershipMonthlyCreditsSnapshot: 500,
            membershipPlan: { code: 'PRO', name: '专业会员' },
          },
          {
            id: 'order-expired',
            status: 'partial_refunded',
            membershipPeriodStartAt: new Date(now - 48 * 3600 * 1000),
            membershipPeriodEndAt: new Date(now - 24 * 3600 * 1000),
            membershipPeriodRevokedAt: null,
            membershipMonthlyCreditsSnapshot: 300,
            membershipPlan: { code: 'BASIC', name: '基础会员' },
          },
          {
            id: 'order-refunded',
            status: 'refunded',
            membershipPeriodStartAt: new Date(now - 24 * 3600 * 1000),
            membershipPeriodEndAt: new Date(now + 24 * 3600 * 1000),
            membershipPeriodRevokedAt: new Date(now),
            membershipMonthlyCreditsSnapshot: 500,
            membershipPlan: { code: 'PRO', name: '专业会员' },
          },
        ]),
      },
      membership: { findMany: vi.fn() },
    };

    await expect(createService(prisma).historyOf('user-1')).resolves.toEqual([
      expect.objectContaining({ id: 'order-active', status: 'active' }),
      expect.objectContaining({ id: 'order-scheduled', status: 'scheduled' }),
      expect.objectContaining({ id: 'order-expired', status: 'expired' }),
      expect.objectContaining({ id: 'order-refunded', status: 'refunded' }),
    ]);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1' }),
        take: 10,
      }),
    );
    expect(prisma.membership.findMany).not.toHaveBeenCalled();
  });

  it('纯旧数据没有订单周期时回退到会员投影', async () => {
    const prisma: any = {
      order: { findMany: vi.fn().mockResolvedValue([]) },
      membership: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'membership-1',
            status: 'expired',
            startAt: new Date('2026-08-01T00:00:00.000Z'),
            expiresAt: new Date('2026-09-01T00:00:00.000Z'),
            monthlyCreditsSnapshot: 300,
            plan: { code: 'BASIC', name: '基础会员' },
          },
        ]),
      },
    };

    await expect(createService(prisma).historyOf('user-1')).resolves.toEqual([
      {
        id: 'membership-1',
        planCode: 'BASIC',
        planName: '基础会员',
        status: 'expired',
        startAt: new Date('2026-08-01T00:00:00.000Z'),
        expiresAt: new Date('2026-09-01T00:00:00.000Z'),
        monthlyCredits: 300,
      },
    ]);
  });
});

describe('MembershipService.checkConcurrency', () => {
  const PERKS = { fastChannel: false, maxConcurrent: 10, addonDiscountBps: 10000 };

  const createService = (active: number) => {
    const count = vi.fn().mockResolvedValue(active);
    const service = new MembershipService(
      { generationTask: { count } } as never,
      { grant: vi.fn() } as never,
      {} as never,
      { invalidate: vi.fn() } as never,
      { invalidate: vi.fn() } as never,
    );
    return { service, count };
  };

  it('本次要创建 5 个任务时，当前 6 个已占额度即超限', async () => {
    const { service } = createService(6);

    await expect(
      service.checkConcurrency('user-1', undefined, PERKS, 5),
    ).rejects.toThrow('本次需要 5 个');
  });

  it('按全部任务计数，不区分父任务与子任务', async () => {
    const { service, count } = createService(5);

    await expect(
      service.checkConcurrency('user-1', undefined, PERKS, 5),
    ).resolves.toEqual({ current: 5, limit: 10 });
    expect(count).toHaveBeenCalledWith({
      where: { ownerId: 'user-1', status: { in: ['queued', 'running'] } },
    });
  });

  it('并发为 0 表示不限，批量任务直接放行', async () => {
    const { service } = createService(20);

    await expect(
      service.checkConcurrency('user-1', undefined, { ...PERKS, maxConcurrent: 0 }, 5),
    ).resolves.toEqual({ current: 20, limit: 0 });
  });
});
