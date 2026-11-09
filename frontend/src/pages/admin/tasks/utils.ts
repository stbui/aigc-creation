/**
 * 任务监控的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 目录内文件不从 `src/lib/*` / `src/admin-ui/lib/*` 直接取东西，一律经由本文件。
 */

/* 外部工具转出：目录内文件不直接引 `src/lib/*` */
export { cn } from '../../../admin-ui/lib/cn';
export { formatDateTime, formatDuration } from '../../../admin-ui/lib/format';
export { taskErrorLabel } from '../../../lib/admin-error-codes';
export { toCredits } from '../../../lib/microcredits';
export {
  adminAssetHref,
  adminBillingOrdersHref,
  adminChannelHref,
  adminCreditHref,
  adminModelCallsHref,
  adminOrderHref,
  adminTaskHref,
  adminTasksHref,
  adminUserDetailHref,
} from '../../../lib/admin-links';

/** 任务短 id: cuid 尾部 8 位。后台表格宽度有限, 全 id 会把列挤到换行 */
export function shortId(id: string): string {
  return id.slice(-8);
}

/** 文件大小展示；未知或 0 显示破折号 */
export function fmtBytes(n: number): string {
  if (n <= 0) return '—';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}
