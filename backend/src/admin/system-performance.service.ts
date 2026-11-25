import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER, type Cache } from '@nestjs/cache-manager';
import { statSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import type { AppConfigValues } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { RouteHealthService } from '../model/routing/route-health.service';
import { SchedulerService } from './scheduler.service';

/**
 * 系统性能快照（`GET /admin/system-performance`）。
 *
 * 页面必须只渲染这里算好的数，不在前端二次聚合。口径固定为三块：
 *   · 运行时 —— 进程已运行时长、内存、CPU 用量与事件循环延迟；
 *   · 数据面 —— 数据库探活耗时与文件大小、素材总量、近 24 小时任务 / 调用耗时；
 *   · 供给面 —— 默认存储探活与线路冷却，以及调度器的连续失败。
 *
 * 这里的数字全部来自**真实调用**：数据库走一次 `SELECT 1`，存储走 `probe()`，
 * 调用耗时取 `ApiCallLog` 终态样本。没有数据时给 `null`，不写 0 ——
 * 「没样本」和「耗时为 0」必须能分开，否则值班时会误判为一切正常。
 */
@Injectable()
export class SystemPerformanceService {
  /** 存储探活 TTL：与 /health 一致，避免页面刷新把云存储变成探针压力源 */
  private static readonly STORAGE_PROBE_TTL_MS = 30_000;
  private static readonly STORAGE_PROBE_CACHE_KEY = 'admin:system-performance:storage';

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly routeHealth: RouteHealthService,
    private readonly scheduler: SchedulerService,
    private readonly config: ConfigService<AppConfigValues, true>,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async snapshot() {
    const started = Date.now();
    const [db, storage, traffic, scheduler, runtime] = await Promise.all([
      this.dbCheck(),
      this.storageCheck(),
      this.traffic(),
      this.schedulerCheck(),
      this.runtime(),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      runtime,
      database: db,
      storage,
      traffic,
      scheduler,
    };
  }

  private async runtime(): Promise<RuntimeResult> {
    const memory = process.memoryUsage();
    const usage = process.cpuUsage();
    const cpuCount = Math.max(1, cpus().length);
    return {
      env: this.config.get<string>('app.env') ?? 'development',
      version: this.version(),
      uptimeSec: Math.round(process.uptime()),
      pid: process.pid,
      node: process.version,
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
      },
      cpu: {
        userMs: Math.round(usage.user / 1000),
        systemMs: Math.round(usage.system / 1000),
        cores: cpuCount,
      },
      /** 事件循环延迟：同步阻塞会让这个数显著抬高 */
      eventLoopLagMs: await eventLoopLag(),
    };
  }

  private version(): string {
    try {
      return String(require('../../package.json').version ?? 'unknown');
    } catch {
      return 'unknown';
    }
  }

  private async dbCheck(): Promise<DatabaseResult> {
    const start = Date.now();
    let ok = false;
    let message: string | undefined;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      ok = true;
    } catch (e) {
      message = (e as Error).message;
    }
    return {
      ok,
      latencyMs: Date.now() - start,
      fileBytes: dbFileBytes(this.config.get<string>('db.url') ?? 'file:./dev.db'),
      message,
    };
  }

  private async storageCheck(): Promise<StorageResult> {
    const backend = this.storage.activeBackend;
    const cached = await this.cache.get<StorageResult>(
      SystemPerformanceService.STORAGE_PROBE_CACHE_KEY,
    );
    if (cached !== undefined) {
      return { ...cached, backend, cached: true };
    }
    const start = Date.now();
    let value: StorageResult;
    try {
      const probe = await this.storage.getActive().probe();
      value = {
        ok: probe.ok,
        latencyMs: probe.latencyMs ?? Date.now() - start,
        backend,
        message: probe.message,
        cached: false,
      };
    } catch (e) {
      value = {
        ok: false,
        latencyMs: Date.now() - start,
        backend,
        message: (e as Error).message,
        cached: false,
      };
    }
    await this.cache.set(
      SystemPerformanceService.STORAGE_PROBE_CACHE_KEY,
      value,
      SystemPerformanceService.STORAGE_PROBE_TTL_MS,
    );
    return value;
  }

  private async traffic(): Promise<TrafficResult> {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [taskStatuses, windowTaskStatuses, callStatuses, callKinds, assetAgg, cooling] =
      await Promise.all([
        this.prisma.generationTask.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.generationTask.groupBy({
          by: ['status'],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
        }),
        this.prisma.apiCallLog.groupBy({
          by: ['status'],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
        }),
        this.prisma.apiCallLog.groupBy({
          by: ['requestKind'],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
        }),
        this.prisma.asset.aggregate({ _sum: { sizeBytes: true }, _count: { _all: true } }),
        Promise.resolve(this.routeHealth.snapshot()),
      ]);

    const byStatus: Record<string, number> = {};
    for (const row of taskStatuses) byStatus[row.status] = row._count._all;

    let taskTotal = 0;
    let succeeded = 0;
    let failed = 0;
    for (const row of windowTaskStatuses) {
      const count = row._count._all;
      taskTotal += count;
      if (row.status === 'succeeded') succeeded = count;
      if (row.status === 'failed') failed = count;
    }

    let callTotal = 0;
    let callFailed = 0;
    let terminal = 0;
    for (const row of callStatuses) {
      callTotal += row._count._all;
      if (row.status === 'success') terminal += row._count._all;
      if (row.status === 'failed') {
        terminal += row._count._all;
        callFailed = row._count._all;
      }
    }

    const byKind: Record<string, number> = {};
    for (const row of callKinds) {
      const kind = row.requestKind || 'unknown';
      byKind[kind] = (byKind[kind] ?? 0) + row._count._all;
    }

    const [taskP95, logP95] = await Promise.all([
      this.taskDurationP95(since, succeeded),
      this.callDurationP95(since, terminal),
    ]);

    return {
      windowHours: 24,
      tasks: {
        total: taskTotal,
        succeeded,
        failed,
        successRate:
          succeeded + failed > 0 ? succeeded / (succeeded + failed) : null,
        p95DurationMs: taskP95,
        byStatus,
      },
      calls: {
        total: callTotal,
        terminal,
        failed: callFailed,
        p95DurationMs: logP95,
        byKind,
      },
      storage: {
        assets: assetAgg._count._all,
        bytes: assetAgg._sum.sizeBytes ?? 0,
      },
      cooling: {
        blocked: cooling.length,
        keys: cooling.slice(0, 10).map((block) => ({
          key: block.key,
          until: new Date(block.until).toISOString(),
        })),
      },
    };
  }

  /**
   * 任务耗时 P95（最近邻，不插值）。
   *
   * 只取排序后的那一行，而不是把 24 小时内的任务全部读进 Node 再排序。
   * 耗时是 `updatedAt - createdAt`，SQL 侧用 julianday 换算成毫秒。
   */
  private async taskDurationP95(since: Date, count: number): Promise<number | null> {
    if (count <= 0) return null;
    const rows = await this.prisma.$queryRaw<Array<{ ms: number | bigint | null }>>`
      SELECT (julianday("updatedAt") - julianday("createdAt")) * 86400000.0 AS ms
      FROM "GenerationTask"
      WHERE "status" = 'succeeded' AND "createdAt" >= ${toDbDateTime(since)}
      ORDER BY ms ASC
      LIMIT 1 OFFSET ${nearestRankOffset(count)}
    `;
    const value = rows[0]?.ms;
    return value === null || value === undefined ? null : Math.max(0, Math.round(Number(value)));
  }

  /** 调用耗时 P95；终态样本与 ApiCallLog 的状态口径一致 */
  private async callDurationP95(since: Date, count: number): Promise<number | null> {
    if (count <= 0) return null;
    const rows = await this.prisma.$queryRaw<Array<{ ms: number | bigint | null }>>`
      SELECT MAX(0, "durationMs") AS ms
      FROM "ApiCallLog"
      WHERE "status" IN ('success', 'failed') AND "createdAt" >= ${toDbDateTime(since)}
      ORDER BY ms ASC
      LIMIT 1 OFFSET ${nearestRankOffset(count)}
    `;
    const value = rows[0]?.ms;
    return value === null || value === undefined ? null : Math.max(0, Math.round(Number(value)));
  }

  private async schedulerCheck() {
    const tasks = this.scheduler.taskStatus().map((task) => ({
      name: task.name,
      label: task.label,
      lastRunAt: task.lastRunAt ? task.lastRunAt.toISOString() : null,
      lastDurationMs: task.lastDurationMs,
      consecutiveFailures: task.consecutiveFailures,
      totalRuns: task.totalRuns,
    }));
    return {
      failing: tasks.filter((task) => task.consecutiveFailures > 0).map((task) => task.name),
      tasks,
    };
  }
}

interface RuntimeResult {
  env: string;
  version: string;
  uptimeSec: number;
  pid: number;
  node: string;
  memory: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
  };
  cpu: { userMs: number; systemMs: number; cores: number };
  eventLoopLagMs: number;
}

interface DatabaseResult {
  ok: boolean;
  latencyMs: number;
  fileBytes: number | null;
  message?: string;
}

interface StorageResult {
  ok: boolean;
  latencyMs: number;
  backend: string;
  message?: string;
  cached: boolean;
}

interface TrafficResult {
  windowHours: number;
  tasks: {
    total: number;
    succeeded: number;
    failed: number;
    successRate: number | null;
    p95DurationMs: number | null;
    byStatus: Record<string, number>;
  };
  calls: {
    total: number;
    terminal: number;
    failed: number;
    p95DurationMs: number | null;
    byKind: Record<string, number>;
  };
  storage: { assets: number; bytes: number };
  cooling: { blocked: number; keys: Array<{ key: string; until: string }> };
}

/** 事件循环延迟采样：把一个 0ms 定时器放到队尾，测它多久才被执行 */
function eventLoopLag(): Promise<number> {
  return new Promise((done) => {
    const start = process.hrtime.bigint();
    setTimeout(() => {
      done(Number(process.hrtime.bigint() - start) / 1_000_000);
    }, 0);
  });
}

/** SQLite 库文件大小；非 file: URL 或读不到时给 null */
function dbFileBytes(url: string): number | null {
  if (!url.startsWith('file:')) return null;
  try {
    return statSync(resolve(process.cwd(), url.replace(/^file:/, ''))).size;
  } catch {
    return null;
  }
}

/** 最近邻百分位对应的行偏移；样本量小时不插值 */
function nearestRankOffset(count: number): number {
  return Math.min(count - 1, Math.max(0, Math.ceil(0.95 * count) - 1));
}

/** Prisma SQLite DateTime 存储格式：`YYYY-MM-DDTHH:mm:ss.SSS+00:00` */
function toDbDateTime(date: Date): string {
  return `${date.toISOString().slice(0, 23)}+00:00`;
}
