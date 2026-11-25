import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminRetentionService, RETENTION_TARGETS } from './retention.service';

/**
 * 自动清理（B-100）的三条不可让步约定。
 *
 * 这是一条**会删数据**的新路径，而它的幂等性完全依赖 `CleanupLog` 里那条
 * `trigger='scheduled'` 的记录：判定写错，轻则一天删一轮变成每 10 分钟删一轮，
 * 重则进程重启后再删一轮。用内存状态判定同样不行 —— 重启清空、多实例各删各的。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function setup(options: { lastScheduledAt?: Date | null; lastTrigger?: string } = {}) {
  const cleanupExpired = vi
    .fn()
    .mockImplementation(async (table: string) => ({ deleted: table === 'ApiCallLog' ? 7 : 1 }));
  const prisma = {
    cleanupLog: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          options.lastScheduledAt === undefined || options.lastScheduledAt === null
            ? null
            : { createdAt: options.lastScheduledAt },
        ),
    },
  };
  const backup = { cleanupExpired };
  const service = new AdminRetentionService(prisma as never, backup as never);
  return { service, prisma, cleanupExpired };
}

describe('AdminRetentionService.runScheduled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('首轮无 scheduled 记录时按各目标默认天数各清一次', async () => {
    const { service, cleanupExpired } = setup({ lastScheduledAt: null });

    const result = await service.runScheduled();

    expect(result.skipped).toBe(false);
    expect(cleanupExpired).toHaveBeenCalledTimes(RETENTION_TARGETS.length);
    for (const target of RETENTION_TARGETS) {
      expect(cleanupExpired).toHaveBeenCalledWith(target.table, target.defaultDays, 'scheduled');
    }
    expect(result.results.map((item) => item.table)).toEqual(
      RETENTION_TARGETS.map((target) => target.table),
    );
  });

  it('距上一轮不足 24 小时时整轮跳过，一条都不删', async () => {
    const { service, cleanupExpired } = setup({
      lastScheduledAt: new Date(Date.now() - 3_600_000),
    });

    const result = await service.runScheduled();

    expect(result).toEqual({ skipped: true, results: [] });
    expect(cleanupExpired).not.toHaveBeenCalled();
  });

  it('超过 24 小时后重新开一轮（节流的边界在“一天”，不是“进程活着就一直跳”）', async () => {
    const { service, cleanupExpired } = setup({
      lastScheduledAt: new Date(Date.now() - DAY_MS - 1_000),
    });

    await expect(service.runScheduled()).resolves.toMatchObject({ skipped: false });
    expect(cleanupExpired).toHaveBeenCalledTimes(RETENTION_TARGETS.length);
  });

  it('人工清理留下的记录不能挡住自动清理（否则运营点一次手动，当天就不再自动跑）', async () => {
    const { service, prisma, cleanupExpired } = setup();
    prisma.cleanupLog.findFirst.mockResolvedValue(null);

    await service.runScheduled();

    // 判定只认 trigger='scheduled'：查不到 scheduled 记录时必须真的执行
    expect(prisma.cleanupLog.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { trigger: 'scheduled' } }),
    );
    expect(cleanupExpired).toHaveBeenCalled();
  });

  it('单个目标失败只记录原因，其余目标照常清理', async () => {
    const { service, cleanupExpired } = setup({ lastScheduledAt: null });
    cleanupExpired.mockImplementationOnce(async () => {
      throw new Error('database is locked');
    });

    const result = await service.runScheduled();

    expect(result.skipped).toBe(false);
    expect(result.results[0]).toEqual({
      table: RETENTION_TARGETS[0].table,
      deleted: 0,
      error: 'database is locked',
    });
    // 失败没有中断循环：剩下的目标仍然执行
    expect(result.results).toHaveLength(RETENTION_TARGETS.length);
    expect(cleanupExpired).toHaveBeenCalledTimes(RETENTION_TARGETS.length);
  });
});
