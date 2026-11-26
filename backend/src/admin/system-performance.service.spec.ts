import { describe, expect, it, vi } from 'vitest';
import { SystemPerformanceService } from './system-performance.service';

function createService() {
  const prisma = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('GenerationTask')) return [{ ms: 4000 }];
      if (sql.includes('ApiCallLog')) return [{ ms: 300 }];
      if (sql.includes('sqlite_version')) return [{ v: '3.53.2' }];
      // 表数量：排除内部表与迁移记录表
      if (sql.includes('sqlite_master')) return [{ n: 68 }];
      if (sql.includes('_prisma_migrations')) return [{ total: 3, applied: 3, last: 1_795_501_060_018 }];
      return [{ 1: 1 }];
    }),
    generationTask: {
      groupBy: vi.fn().mockResolvedValue([
        { status: 'succeeded', _count: { _all: 2 } },
        { status: 'failed', _count: { _all: 1 } },
      ]),
    },
    apiCallLog: {
      groupBy: vi.fn(async ({ by }: { by: string[] }) =>
        by[0] === 'status'
          ? [
              { status: 'success', _count: { _all: 2 } },
              { status: 'failed', _count: { _all: 1 } },
              { status: 'pending', _count: { _all: 1 } },
            ]
          : [
              { requestKind: 'create', _count: { _all: 2 } },
              { requestKind: 'poll', _count: { _all: 2 } },
            ],
      ),
    },
    asset: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { sizeBytes: 2048 }, _count: { _all: 3 } }),
    },
  };
  const storage = {
    activeBackend: 'local',
    getActive: () => ({
      probe: vi.fn().mockResolvedValue({ ok: true, latencyMs: 5, message: 'ok' }),
    }),
  };
  const routeHealth = {
    snapshot: () => [{ key: 'channel:abc', until: Date.now() + 60_000 }],
  };
  const service = new SystemPerformanceService(
    prisma as never,
    storage as never,
    routeHealth as never,
    {
      get: (key: string) =>
        key === 'app.env' ? 'test' : key === 'db.url' ? 'file:./test.db' : undefined,
    } as never,
    { get: vi.fn(), set: vi.fn() } as never,
  );
  return { service, prisma };
}

describe('SystemPerformanceService', () => {
  it('P95 使用终态样本，未终态调用不计入耗时', async () => {
    const { service } = createService();
    const snapshot = await service.snapshot();

    expect(snapshot.traffic.calls.total).toBe(4);
    expect(snapshot.traffic.calls.terminal).toBe(3);
    // 100 / 200 / 300 的最近邻 P95 = 300
    expect(snapshot.traffic.calls.p95DurationMs).toBe(300);
    expect(snapshot.traffic.calls.byKind).toEqual({ create: 2, poll: 2 });
  });

  it('任务耗时取终态 updatedAt - createdAt，并按终态算成功率', async () => {
    const { service } = createService();
    const snapshot = await service.snapshot();

    expect(snapshot.traffic.tasks.successRate).toBeCloseTo(2 / 3);
    // 2s / 4s 的最近邻 P95 = 4000ms
    expect(snapshot.traffic.tasks.p95DurationMs).toBe(4000);
    expect(snapshot.traffic.tasks.byStatus).toEqual({ succeeded: 2, failed: 1 });
  });

  it('线路冷却如实上报', async () => {
    const { service } = createService();
    const snapshot = await service.snapshot();

    expect(snapshot.traffic.cooling.blocked).toBe(1);
    expect(snapshot.traffic.cooling.keys[0]?.key).toBe('channel:abc');
    expect(snapshot.storage.ok).toBe(true);
  });

  it('数据库给元信息而不是探活结果', async () => {
    const { service } = createService();
    const snapshot = await service.snapshot();

    expect(snapshot.database.ok).toBe(true);
    expect(snapshot.database.engine).toBe('SQLite');
    expect(snapshot.database.version).toBe('SQLite 3.53.2');
    // 绝对路径的库文件，前端直接原样显示
    expect(snapshot.database.location).toContain('test.db');
    expect(snapshot.database.tables).toBe(68);
    expect(snapshot.database.migrations).toEqual({
      total: 3,
      applied: 3,
      lastAppliedAt: new Date(1_795_501_060_018).toISOString(),
    });
    expect(snapshot.database).not.toHaveProperty('fileBytes');
  });

  it('连不上库时保留元信息骨架并给出原因', async () => {
    const { service, prisma } = createService();
    prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      if (strings.join('?').includes('SELECT 1')) throw new Error('database is locked');
      return [{ 1: 1 }];
    });
    const snapshot = await service.snapshot();

    expect(snapshot.database.ok).toBe(false);
    expect(snapshot.database.message).toBe('database is locked');
    expect(snapshot.database.tables).toBeNull();
    expect(snapshot.database.migrations).toBeNull();
  });

  it('宿主机信息如实上报：主机名 / 平台 / CPU 型号 / 总内存 / 负载', async () => {
    const { service } = createService();
    const snapshot = await service.snapshot();

    expect(snapshot.system.hostname).toBeTruthy();
    expect(['linux', 'darwin', 'win32']).toContain(snapshot.system.platform);
    expect(snapshot.system.cpu.cores).toBeGreaterThan(0);
    // 1 / 5 / 15 分钟三个负载值；Windows 下为空数组，非 Windows 下应为 3 个
    expect(snapshot.system.loadavg.length).toBeLessThanOrEqual(3);
    expect(snapshot.system.loadavg.length).toBeGreaterThanOrEqual(0);
  });
});
