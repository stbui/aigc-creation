import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminRoleService } from './admin-role.service';

describe('AdminRoleService.updatePermissions', () => {
  let prisma: {
    adminRole: { findUnique: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let service: AdminRoleService;

  beforeEach(() => {
    prisma = {
      adminRole: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    };
    service = new AdminRoleService(prisma as never);
  });

  it('同一事务内更新全部角色并返回准确的权限差异', async () => {
    const update = vi.fn().mockResolvedValue({});
    prisma.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) =>
      work({
        adminRole: {
          findMany: vi.fn().mockResolvedValue([
            { code: 'admin', permissions: JSON.stringify(['user.read', 'role.write']) },
            { code: 'operator', permissions: JSON.stringify(['user.read']) },
          ]),
          update,
        },
      }),
    );

    const changes = await service.updatePermissions([
      { code: 'admin', permissions: ['user.read'] },
      { code: 'operator', permissions: ['user.read', 'ticket.handle'] },
    ]);

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(1, {
      where: { code: 'admin' },
      data: { permissions: JSON.stringify(['user.read']) },
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { code: 'operator' },
      data: { permissions: JSON.stringify(['user.read', 'ticket.handle']) },
    });
    expect(changes).toEqual([
      {
        code: 'admin',
        before: ['user.read', 'role.write'],
        after: ['user.read'],
        added: [],
        removed: ['role.write'],
      },
      {
        code: 'operator',
        before: ['user.read'],
        after: ['user.read', 'ticket.handle'],
        added: ['ticket.handle'],
        removed: [],
      },
    ]);
  });

  it('未知权限点在开启事务前整体拒绝', async () => {
    await expect(
      service.updatePermissions([
        { code: 'operator', permissions: ['user.read', 'not.real'] },
      ]),
    ).rejects.toMatchObject({ code: 40001 });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('任一角色不存在时不产生任何更新', async () => {
    const update = vi.fn();
    prisma.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) =>
      work({
        adminRole: {
          findMany: vi.fn().mockResolvedValue([
            { code: 'operator', permissions: JSON.stringify(['user.read']) },
          ]),
          update,
        },
      }),
    );

    await expect(
      service.updatePermissions([
        { code: 'operator', permissions: [] },
        { code: 'finance', permissions: [] },
      ]),
    ).rejects.toMatchObject({ code: 40400 });
    expect(update).not.toHaveBeenCalled();
  });

  it('重复角色整体拒绝', async () => {
    await expect(
      service.updatePermissions([
        { code: 'operator', permissions: [] },
        { code: 'operator', permissions: ['user.read'] },
      ]),
    ).rejects.toMatchObject({ code: 40001 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
