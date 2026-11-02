/**
 * 后台展示用的格式化函数。
 *
 * 全部是纯函数，不碰 React。放一处的理由：同一个日期在列表、抽屉、导出里
 * 出现三次，各页自己写 `toLocaleString('zh-CN')` 迟早出现两种写法。
 */

/** ISO 字符串 → `2026/11/02 14:03:12`。无法解析时原样返回。 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString('zh-CN', { hour12: false });
}

/** ISO 字符串 → `2026/11/02`。 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleDateString('zh-CN');
}

/** 只取时分秒，用于「最后一次成功」这类同日内比较的场景。 */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

/**
 * 耗时。超过一分钟就折成「分 / 小时」——
 * 失败任务的耗时可能是几十分钟到几小时，只到「分」会把 46 小时写成 2779 分。
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.round(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes < 60) return `${minutes}分${seconds}秒`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}小时${rest}分` : `${hours}小时`;
}

/** 相对时间：`刚刚 / 3 分钟前 / 2 小时前 / 5 天前`。 */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return String(iso);
  const diff = Date.now() - time;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

/** 分 → `¥12.34`。金额一律以「分」为整数在前后端间传输。 */
export function formatYuan(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—';
  return `¥${(cents / 100).toFixed(2)}`;
}

/** 字节 → `1.2 MB`。 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${index === 0 ? value : value.toFixed(1)} ${units[index]}`;
}

/** 数字加千分位。统计卡与计数列统一用它，保证 `tabular-nums` 对齐后不跳宽。 */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('zh-CN');
}

/**
 * 值班塔刻度高度：对数映射耗时到 8–24px。
 *
 * 线性映射会让 5 秒和 60 秒挤在同样高度；对数把短任务拉开，又不让一个
 * 超时任务把整排刻度压成一条线。
 */
export function tickHeight(durationMs: number, dense = false): number {
  const min = dense ? 4 : 8;
  const max = dense ? 14 : 24;
  const clamped = Math.min(Math.max(durationMs, 0), 60_000);
  const ratio = Math.log1p(clamped / 1000) / Math.log1p(60);
  return Math.round(min + (max - min) * ratio);
}
