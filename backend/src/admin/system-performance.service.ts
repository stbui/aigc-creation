import { Injectable } from '@nestjs/common';
import { statSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
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
  private storageCache: { at: number; value: StorageResult } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly routeHealth: RouteHealthService,
    private readonly scheduler: SchedulerService,
    private readonly config: ConfigService,
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
      env: this.config.get<string>('app.env') ?? process.env.NODE_ENV ?? 'development',
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
    if (
      this.storageCache &&
      Date.now() - this.storageCache.at < SystemPerformanceService.STORAGE_PROBE_TTL_MS
    ) {
      return { ...this.storageCache.value, backend, cached: true };
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
    this.storageCache = { at: Date.now(), value };
    return value;
  }

  private async traffic(): Promise<TrafficResult> {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [taskStatuses, taskRows, logRows, assetAgg, cooling] = await Promise.all([
      this.prisma.generationTask.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.generationTask.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true, updatedAt: true, status: true },
      }),
      this.prisma.apiCallLog.findMany({
        where: { createdAt: { gte: since } },
        select: { status: true, durationMs: true, requestKind: true },
      }),
      this.prisma.asset.aggregate({ _sum: { sizeBytes: true }, _count: { _all: true } }),
      Promise.resolve(this.routeHealth.snapshot()),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of taskStatuses) byStatus[row.status] = row._count._all;
    const succeeded = taskRows.filter((row) => row.status === 'succeeded');
    const failed = taskRows.filter((row) => row.status === 'failed');
    const taskDurations = succeeded
      .map((row) => Math.max(0, row.updatedAt.getTime() - row.createdAt.getTime()))
      .sort((a, b) => a - b);
    const terminalLogs = logRows.filter(
      (row) => row.status === 'success' || row.status === 'failed',
    );
    const logDurations = terminalLogs
      .map((row) => Math.max(0, row.durationMs))
      .sort((a, b) => a - b);

    return {
      windowHours: 24,
      tasks: {
        total: taskRows.length,
        succeeded: succeeded.length,
        failed: failed.length,
        successRate:
          succeeded.length + failed.length > 0
            ? succeeded.length / (succeeded.length + failed.length)
            : null,
        p95DurationMs: percentile(taskDurations, 0.95),
        byStatus,
      },
      calls: {
        total: logRows.length,
        terminal: terminalLogs.length,
        failed: terminalLogs.filter((row) => row.status === 'failed').length,
        p95DurationMs: percentile(logDurations, 0.95),
        byKind: countBy(logRows, (row) => row.requestKind || 'unknown'),
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

/**
 * 最近邻百分位（不做插值）。
 *
 * 与 `ChannelModelMetricsService` 同一实现：样本量小时，插值出来的
 * 「P95 耗时 1234ms」会让人误以为测过很多次。
 */
function percentile(sorted: number[], ratio: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return sorted[index];
}

function countBy<T>(rows: T[], keyOf: (row: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = keyOf(row);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
