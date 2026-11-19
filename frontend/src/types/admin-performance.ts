/**
 * 系统性能快照（`GET /admin/system-performance`）。
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
  database: {
    ok: boolean;
    latencyMs: number;
    fileBytes: number | null;
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
  scheduler: {
    failing: string[];
    tasks: Array<{
      name: string;
      label: string;
      lastRunAt: string | null;
      lastDurationMs: number | null;
      consecutiveFailures: number;
      totalRuns: number;
    }>;
  };
}
