import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountService } from './account.service';

/**
 * /me 聚合查询的口径保真测试。
 *
 * 5 个 count 合并为一条 $queryRaw 后，最容易出的回归是：
 *   · COUNT(*) 的 bigint 未转 number → JSON.stringify 抛错
 *   · 返回形状 counts/unread 漂移 → 前端契约破坏
 *   · "Order" 保留字未加引号 → SQLite 语法错误
 * 这里用 mock 固定 $queryRaw 返回值，锁定映射与形状。
 */
describe('AccountService.profile 聚合计数', () => {
  let prisma: Record<string, any>;
  let service: AccountService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-1',
          email: 'user@example.com',
          name: null,
          phone: null,
          phoneVerifiedAt: null,
          emailVerifiedAt: null,
          passwordHash: 'hash',
          status: 'active',
          createdAt: new Date(),
          lastLoginAt: null,
          mustChangePassword: false,
          tempPasswordExpiresAt: null,
          oauthIdentities: [{ provider: 'google' }],
        }),
      },
      $queryRaw: vi.fn().mockResolvedValue([{
        projects: 2n,
        tasks: 3n,
        assets: 4n,
        orders: 5n,
        unread: 6n,
      }]),
    };
    service = new AccountService(
      prisma as never,
      { softDelete: vi.fn() } as never,
      { invalidate: vi.fn().mockResolvedValue(undefined) } as never,
    );
  });

  it('把 COUNT(*) 的 bigint 转成 number，保持 counts/unread 形状不变', async () => {
    const profile = await service.profile('user-1');
    expect(profile.counts).toEqual({ projects: 2, tasks: 3, assets: 4, orders: 5 });
    expect(profile.unread).toBe(6);
    expect(typeof profile.unread).toBe('number');
    expect(() => JSON.stringify(profile)).not.toThrow();
  });

  it('聚合 SQL 覆盖 5 个子查询，且 "Order" 加引号', async () => {
    await service.profile('user-1');
    const sql = prisma.$queryRaw.mock.calls[0][0];
    const raw = Array.isArray(sql) ? sql.join('') : String(sql);
    expect(raw).toContain('FROM Project');
    expect(raw).toContain('FROM GenerationTask');
    expect(raw).toContain('FROM Asset');
    expect(raw).toContain('FROM "Order"');
    expect(raw).toContain('FROM Notification');
    expect(raw.match(/COUNT\(\*\)/g)).toHaveLength(5);
  });
});
