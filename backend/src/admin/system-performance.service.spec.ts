import { describe, expect, it, vi } from 'vitest';
import { SystemPerformanceService } from './system-performance.service';

function createService() {
  const prisma = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('GenerationTask')) return [{ ms: 4000 }];
      if (sql.includes('ApiCallLog')) return [{ ms: 300 }];
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
  const scheduler = {
    taskStatus: () => [
      {
        name: 'backup',
        label: '数据备份',
        lastRunAt: new Date('2026-11-19T00:00:00Z'),
        lastDurationMs: 42,
        consecutiveFailures: 2,
        totalRuns: 7,
      },
    ],
  };
  const service = new SystemPerformanceService(
    prisma as never,
    storage as never,
    routeHealth as never,
    scheduler as never,
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

  it('调度器失败与线路冷却如实上报', async () => {
    const { service } = createService();
    const snapshot = await service.snapshot();

    expect(snapshot.scheduler.failing).toEqual(['backup']);
    expect(snapshot.traffic.cooling.blocked).toBe(1);
    expect(snapshot.traffic.cooling.keys[0]?.key).toBe('channel:abc');
    expect(snapshot.storage.ok).toBe(true);
    expect(snapshot.database.ok).toBe(true);
  });
});
