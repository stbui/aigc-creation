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
