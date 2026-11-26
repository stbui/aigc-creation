import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER, type Cache } from '@nestjs/cache-manager';
import { statSync } from 'node:fs';
import { arch, cpus, hostname, loadavg, release as osRelease, type, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated/prisma/client';
import type { AppConfigValues } from '../config/env.validation';
import { PrismaService, isSqliteUrl } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { RouteHealthService } from '../model/routing/route-health.service';

/**
 * 系统信息快照（`GET /admin/system-performance`）。
 *
 * 页面必须只渲染这里算好的数，不在前端二次聚合。口径固定为三块：
 *   · 机器 —— 宿主机身份与容量（`os` 模块，与进程占用分开）；
 *   · 运行时 —— 进程已运行时长、内存、CPU 用量与事件循环延迟；
 *   · 数据面 —— 数据库本身的类型 / 版本 / 位置 / 体积 / 表数量 / 迁移进度，
 *     默认存储探活与线路冷却，以及近 24 小时任务 / 调用耗时。
 *
 * 这里的数字全部来自**真实调用**：数据库按方言查版本与元数据，存储走 `probe()`，
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
    private readonly config: ConfigService<AppConfigValues, true>,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /** 当前 PrismaService 连接的方言；raw SQL 的方言分支统一从这里取值 */
  private isPostgresDialect(): boolean {
    return !isSqliteUrl(this.config.get<string>('db.url'));
  }

  async snapshot() {
    const started = Date.now();
    const [db, storage, traffic, runtime] = await Promise.all([
      this.database(),
      this.storageCheck(),
      this.traffic(),
      this.runtime(),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      runtime,
      database: db,
      storage,
      traffic,
      system: this.systemInfo(),
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

  private systemInfo(): SystemResult {
    const cpuList = cpus();
    const load = loadavg();
    return {
      hostname: safeHostname(),
      platform: process.platform,
      arch: arch(),
      kernel: osRelease(),
      nodeVersion: process.version,
      cpu: {
        model: cpuList[0]?.model?.trim() || 'unknown',
        cores: cpuList.length || 1,
      },
      /** 系统总内存；进程内不可用时为 null，前端显示「—」而不是编造 0 */
      totalMemoryBytes: totalMemory(),
      /** 系统负载均值（1 / 5 / 15 分钟）；Windows 等无该指标的平台上为空数组 */
      loadavg: load.map((value) => Math.round(value * 100) / 100),
    };
  }

  private version(): string {
    try {
      return String(require('../../package.json').version ?? 'unknown');
    } catch {
      return 'unknown';
    }
  }

  /**
   * 数据库本身的元信息，不是「通不通」。
   *
   * 一次 `SELECT 1` 只够判断可用性，排障时真正要看的是连的哪个库、什么版本、
   * 多大、有多少张表、迁移落到哪一版。这些按方言各查各的：SQLite 能 stat 文件、
   * 能读 `sqlite_master`；PG 是网络服务，位置只能从连接串取 host/db，体积留 null。
   * 任何一项取不到都给 null（前端显示「—」），不猜、不写 0。
   */
  private async database(): Promise<DatabaseResult> {
    const url = this.config.get<string>('db.url') ?? 'file:./dev.db';
    const postgres = this.isPostgresDialect();
    const base: DatabaseResult = {
      ok: false,
      engine: postgres ? 'PostgreSQL' : 'SQLite',
      version: null,
      location: dbLocation(url),
      sizeBytes: postgres ? null : dbFileBytes(url),
      tables: null,
      migrations: null,
      latencyMs: 0,
    };

    const start = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      return { ...base, latencyMs: Date.now() - start, message: (e as Error).message };
    }
    const latencyMs = Date.now() - start;

    const [version, tables, migrations] = await Promise.all([
      this.dbVersion(postgres),
      this.dbTables(postgres),
      this.dbMigrations(),
    ]);
    return { ...base, ok: true, latencyMs, version, tables, migrations };
  }

  /** 服务端版本：SQLite 读 `sqlite_version()`，PG 读 `current_setting('server_version')` */
  private async dbVersion(postgres: boolean): Promise<string | null> {
    try {
      const rows = postgres
        ? await this.prisma.$queryRaw<Array<{ v: string | null }>>`
            SELECT current_setting('server_version') AS v
          `
        : await this.prisma.$queryRaw<Array<{ v: string | null }>>`SELECT sqlite_version() AS v`;
      const value = rows[0]?.v;
      if (!value) return null;
      return `${postgres ? 'PostgreSQL' : 'SQLite'} ${value}`;
    } catch {
      return null;
    }
  }

  /** 业务表数量；两档都排除内部表与 Prisma 的迁移记录表，口径一致才敢摆在一起比 */
  private async dbTables(postgres: boolean): Promise<number | null> {
    try {
      const rows = postgres
        ? await this.prisma.$queryRaw<Array<{ n: number | bigint }>>`
            SELECT COUNT(*) AS n FROM pg_tables
            WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
          `
        : await this.prisma.$queryRaw<Array<{ n: number | bigint }>>`
            SELECT COUNT(*) AS n FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'
          `;
      const value = rows[0]?.n;
      return value === null || value === undefined ? null : Number(value);
    } catch {
      return null;
    }
  }

  /** 迁移落库进度；`_prisma_migrations` 不存在时返回 null，不写 0/0 假装干净 */
  private async dbMigrations(): Promise<MigrationResult | null> {
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ total: number | bigint | null; applied: number | bigint | null; last: unknown }>
      >`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN "finished_at" IS NOT NULL THEN 1 ELSE 0 END) AS applied,
               MAX("finished_at") AS last
        FROM "_prisma_migrations"
      `;
      const row = rows[0];
      if (!row) return null;
      return {
        total: Number(row.total ?? 0),
        applied: Number(row.applied ?? 0),
        lastAppliedAt: toIsoFromDb(row.last),
      };
    } catch {
      return null;
    }
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
   * 耗时是 `updatedAt - createdAt`，毫秒换算按方言分支：
   *   · PG：interval 减法 + EXTRACT(EPOCH FROM interval)
   *   · SQLite：julianday 差值 × 一天的毫秒数
   * 两侧都按毫秒数值排序，取数语义一致。
   */
  private async taskDurationP95(since: Date, count: number): Promise<number | null> {
    if (count <= 0) return null;
    const selectMs = this.isPostgresDialect()
      ? Prisma.sql`EXTRACT(EPOCH FROM ("updatedAt" - "createdAt")) * 1000.0`
      : Prisma.sql`(julianday("updatedAt") - julianday("createdAt")) * 86400000.0`;
    const rows = await this.prisma.$queryRaw<Array<{ ms: number | bigint | null }>>`
      SELECT ${selectMs} AS ms
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
    // GREATEST 是 PG 函数，SQLite 对应的是多参数标量 max()；CASE WHEN 两边通用。
    const rows = await this.prisma.$queryRaw<Array<{ ms: number | bigint | null }>>`
      SELECT (CASE WHEN "durationMs" > 0 THEN "durationMs" ELSE 0 END) AS ms
      FROM "ApiCallLog"
      WHERE "status" IN ('success', 'failed') AND "createdAt" >= ${toDbDateTime(since)}
      ORDER BY ms ASC
      LIMIT 1 OFFSET ${nearestRankOffset(count)}
    `;
    const value = rows[0]?.ms;
    return value === null || value === undefined ? null : Math.max(0, Math.round(Number(value)));
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

interface SystemResult {
  hostname: string;
  platform: string;
  arch: string;
  kernel: string;
  nodeVersion: string;
  cpu: { model: string; cores: number };
  totalMemoryBytes: number | null;
  /** 系统负载均值（1 / 5 / 15 分钟）；Windows 等无该指标的平台上为空数组 */
  loadavg: number[];
}

interface MigrationResult {
  total: number;
  applied: number;
  lastAppliedAt: string | null;
}

interface DatabaseResult {
  ok: boolean;
  engine: string;
  version: string | null;
  /** 脱敏后的库位置：SQLite 是库文件绝对路径，PG 是 host[:port]/database，不含凭据 */
  location: string | null;
  /** 库体积；PG 无法从连接串推出，保持 null */
  sizeBytes: number | null;
  tables: number | null;
  migrations: MigrationResult | null;
  /** 一次 `SELECT 1` 的往返耗时，用来看库侧延迟，不代表可用性 */
  latencyMs: number;
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

/**
 * 主机名。取不到时回落到 `host` —— 页面要显示一个能认出的实例标识，
 * 但不能因为 `os.hostname()` 抛错就让整个快照失败。
 */
function safeHostname(): string {
  try {
    return hostname() || 'host';
  } catch {
    return 'host';
  }
}

/** 系统总内存；`totalmem()` 不可用时返回 null，前端显示「—」而不是 0 */
function totalMemory(): number | null {
  try {
    const total = totalmem();
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

/**
 * 数据库文件大小。
 *
 * SQLite 是本地单文件，可以直接 stat；PostgreSQL 是网络服务，size 不能从
 * 连接串推出，返回 null 表示「不适用」——前端已把 null 显示为非本地文件库，
 * 不要在这里猜一个路径去 stat（那会拿到一个不存在的本地文件、显示 0）。
 */
function dbFileBytes(url: string): number | null {
  if (!url.startsWith('file:')) return null;
  try {
    return statSync(resolve(process.cwd(), url.replace(/^file:/, ''))).size;
  } catch {
    return null;
  }
}

/**
 * 库位置。只输出「连的是哪个库」这一件事，绝不带用户名和密码：
 * SQLite 展开成绝对路径；PG 只保留 host[:port]/database；解析失败返回 null。
 */
function dbLocation(url: string): string | null {
  if (!url) return null;
  if (url.startsWith('file:')) {
    return resolve(process.cwd(), url.slice('file:'.length));
  }
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, '');
    const host = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
    if (!host) return null;
    return database ? `${host}/${database}` : host;
  } catch {
    return null;
  }
}

/**
 * 迁移时间列的类型两档不同：SQLite 存毫秒整数，PG 返回 timestamp。
 * 统一成 ISO 字符串交给前端格式化，取不到就 null，不让一列脏值把整个快照带崩。
 */
function toIsoFromDb(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric).toISOString();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** 最近邻百分位对应的行偏移；样本量小时不插值 */
function nearestRankOffset(count: number): number {
  return Math.min(count - 1, Math.max(0, Math.ceil(0.95 * count) - 1));
}

/**
 * 原生 SQL 的 UTC 时间字面量：`YYYY-MM-DDTHH:mm:ss.SSS+00:00`。
 * SQLite 按此格式存 DateTime 字符串；PostgreSQL 的 timestamp 列也能解析
 * 带 +00:00 的 ISO 字面量。保持纯字符串参数，避免依赖各驱动的 Date 编码差异。
 */
function toDbDateTime(date: Date): string {
  return `${date.toISOString().slice(0, 23)}+00:00`;
}
