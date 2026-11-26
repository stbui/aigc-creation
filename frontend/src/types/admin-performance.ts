/**
 * 系统信息快照（`GET /admin/system-performance`）。
 *
 * 与后端 `SystemPerformanceService.snapshot()` 的返回体一一对应。没有样本的
 * 耗时字段一律是 `null`，前端显示「—」而不是 0。
 */
export interface AdminSystemPerformance {
  generatedAt: string;
  /** 本次快照采集耗时；接口自身变慢时先看它 */
  durationMs: number;
  runtime: {
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
    cpu: {
      /** 进程启动以来的累计 CPU 时间（毫秒），不是瞬时占用率 */
      userMs: number;
      systemMs: number;
      cores: number;
    };
    /** 事件循环延迟（毫秒）；同步阻塞会显著抬高 */
    eventLoopLagMs: number;
  };
  /**
   * 宿主机系统信息：主机名、平台、CPU 型号与核数、总内存、系统负载均值。
   * 与 `runtime`（本 Node 进程）分开 —— 一个是「机器」，一个是「进程」，
   * 混在一起会把容器里看到的宿主机指标误读成进程自己的占用。
   */
  system: {
    hostname: string;
    platform: string;
    arch: string;
    kernel: string;
    nodeVersion: string;
    cpu: { model: string; cores: number };
    /** 系统总内存；平台不提供时为 null，前端显示「—」而不是编造 0 */
    totalMemoryBytes: number | null;
    /** 系统负载均值（1 / 5 / 15 分钟）；Windows 等无该指标的平台为空数组 */
    loadavg: number[];
  };
  /**
   * 数据库本身的元信息（引擎 / 版本 / 位置 / 体积 / 表数量 / 迁移进度）。
   *
   * 取不到的项是 `null`，前端显示「—」；`ok` 只表示这一次有没有连上库，
   * 连不上时 `message` 带原因。
   */
  database: {
    ok: boolean;
    engine: string;
    version: string | null;
    location: string | null;
    sizeBytes: number | null;
    tables: number | null;
    migrations: { total: number; applied: number; lastAppliedAt: string | null } | null;
    /** 一次 `SELECT 1` 的往返耗时，用来看库侧延迟 */
    latencyMs: number;
    message?: string;
  };
  storage: {
    ok: boolean;
    latencyMs: number;
    backend: string;
    message?: string;
    /** 30 秒内复用过探活结果 */
    cached: boolean;
  };
  traffic: {
    windowHours: number;
    tasks: {
      total: number;
      succeeded: number;
      failed: number;
      /** 终态成功率；没有终态样本时为 null */
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
    cooling: {
      blocked: number;
      keys: Array<{ key: string; until: string }>;
    };
  };
}
