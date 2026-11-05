import { describe, expect, it, vi } from 'vitest';

import { UserGroupAdminService } from './user-group.admin.service';

function groupRow(
  code: string,
  id = `group-${code}`,
): {
  id: string;
  code: string;
  name: string;
  description: string;
  badgeLabel: string;
  badgeStyle: string;
  sortOrder: number;
  ratioBasisPoints: number;
  pointsPerUsd: bigint;
  pointsPerCny: bigint;
  allChannels: boolean;
  modelOverridesJson: string;
} {
  return {
    id,
    code,
    name: code,
    description: '',
    badgeLabel: '',
    badgeStyle: 'none',
    sortOrder: 0,
    ratioBasisPoints: 10_000,
    pointsPerUsd: 7_000_000n,
    pointsPerCny: 1_000_000n,
    allChannels: true,
    modelOverridesJson: '[]',
  };
}

describe('UserGroupAdminService 分组用户数', () => {
  it('有效快照计入会员组，过期快照回落默认组，仅旧会员回退 Membership 投影', async () => {
    const prisma = {
      userGroup: {
        findMany: vi.fn().mockResolvedValue([
          groupRow('default'),
          groupRow('vip'),
          groupRow('legacy'),
        ]),
      },
      userGroupChannel: { findMany: vi.fn().mockResolvedValue([]) },
      order: {
        findMany: vi
          .fn()
          // 当前有效周期：即使套餐后来映射到 legacy，也使用下单时的 vip 快照。
          .mockResolvedValueOnce([
            {
              userId: 'active-snapshot-user',
              membershipPlanId: 'plan-active',
              membershipUserGroupCodeSnapshot: 'vip',
            },
          ])
          // 所有有过会员周期快照的用户，包含已过期或已退款撤销的用户。
          .mockResolvedValueOnce([
            { userId: 'active-snapshot-user' },
            { userId: 'expired-snapshot-user' },
          ]),
      },
      membership: {
        findMany: vi.fn().mockResolvedValue([
          // Membership 投影尚未及时同步，不能覆盖已有订单周期快照。
          { userId: 'expired-snapshot-user', planId: 'plan-active' },
          // 完全没有订单周期快照的历史会员才按 Membership 投影计数。
          { userId: 'legacy-membership-user', planId: 'plan-legacy' },
        ]),
      },
      membershipPlan: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'plan-active', userGroupCode: 'legacy' },
          { id: 'plan-legacy', userGroupCode: 'legacy' },
        ]),
      },
      user: { count: vi.fn().mockResolvedValue(4) },
    };
    const service = new UserGroupAdminService(prisma as never, {} as never, {} as never);

    const views = await service.list();
    const counts = new Map(views.map((view) => [view.code, view.userCount]));

    expect(counts).toEqual(
      new Map([
        ['default', 2],
        ['vip', 1],
        ['legacy', 1],
      ]),
    );
    expect([...counts.values()].reduce((total, count) => total + count, 0)).toBe(4);
  });

  it('套餐已改映射时仍禁止删除当前或未来周期快照使用的分组', async () => {
    const prisma = {
      userGroup: {
        findFirst: vi.fn().mockResolvedValue(groupRow('vip', 'group-vip')),
      },
      membershipPlan: { findMany: vi.fn().mockResolvedValue([]) },
      order: { count: vi.fn().mockResolvedValue(2) },
      $transaction: vi.fn(),
    };
    const groups = { invalidate: vi.fn() };
    const catalogVersion = { invalidate: vi.fn() };
    const service = new UserGroupAdminService(
      prisma as never,
      groups as never,
      catalogVersion as never,
    );

    await expect(service.remove('group-vip')).rejects.toThrow(
      '仍有 2 个当前或未来会员周期使用该分组',
    );
    expect(prisma.order.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        membershipUserGroupCodeSnapshot: 'vip',
        membershipPeriodRevokedAt: null,
        status: { in: ['paid', 'partial_refunded'] },
      }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(groups.invalidate).not.toHaveBeenCalled();
    expect(catalogVersion.invalidate).not.toHaveBeenCalled();
  });
});
