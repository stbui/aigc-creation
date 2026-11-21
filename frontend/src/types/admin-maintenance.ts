/** 后台运维域：数据备份、保留期清理日志与定时任务状态。 */

/* ────────────────────────────────────────────────────────────────
   数据备份 (admin-prd.md §3.19 B-96~B-101)
   ──────────────────────────────────────────────────────────────── */

/** GET /api/v1/admin/backups */
export interface AdminBackup {
  id: string;
  filename: string;
  sizeBytes: number;
  /** SHA-256 十六进制, 64 位 */
  sha256: string;
  trigger: "manual" | "scheduled";
  status: "pending" | "succeeded" | "failed";
  errorMessage: string | null;
  sourceSizeBytes: number | null;
  /** B-97: 无验证记录的备份视为无效 */
  verified: boolean;
  verifiedAt: string | null;
  verifyReport: string | null;
  verifyWarnings: string | null;
  createdAt: string;
}

/** GET /api/v1/admin/backups/stats */
export interface AdminBackupStats {
  total: number;
  succeeded: number;
  verified: number;
  /** 未验证份数 —— 需提醒运维尽快验证 */
  unverified: number;
  failed: number;
  totalBytes: number;
  totalMb: number;
  lastSuccessAt: string | null;
  /** 超过 24 小时无成功备份即视为异常 */
  stale: boolean;
}

/** GET /api/v1/admin/retention/logs */
export interface AdminCleanupLog {
  id: string;
  target: string;
  deletedCount: number;
  retentionDays: number;
  trigger: "manual" | "scheduled";
  skippedCount: number;
  detail: string;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

/* ────────────────────────────────────────────────────────────────
   定时任务 (admin-prd.md §3.18 B-90 / M9.5)
   ──────────────────────────────────────────────────────────────── */

/** GET /api/v1/admin/scheduler/status */
export interface AdminSchedulerTask {
  /** 任务标识, 如 'order-expire' | 'credit-expire' | 'backup' */
  name: string;
  label: string;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastSuccess: boolean | null;
  lastError: string | null;
  /** 连续失败次数。> 0 即任务已停止生效 */
  consecutiveFailures: number;
  totalRuns: number;
}

export interface AdminSchedulerStatus {
  tasks: AdminSchedulerTask[];
  /** 允许手动触发的任务名。只有幂等低风险的才开放 */
  manuallyRunnable: string[];
  /** 当前有连续失败的任务名, 前端据此置顶告警 */
  failing: string[];
}
