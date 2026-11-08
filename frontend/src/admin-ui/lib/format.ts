/**
 * 后台展示用的格式化函数。
 *
 * 全部是纯函数，不碰 React。放一处的理由：同一个日期在列表、抽屉、导出里
 * 出现三次，各页自己写 `toLocaleString('zh-CN')` 迟早出现两种写法。
 */

/** 日期时间渲染本体：只有「无法解析时显示什么」这一处口径差异。 */
function displayDateTime(iso: string, invalidFallback: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return invalidFallback;
  return date.toLocaleString('zh-CN', { hour12: false });
}

/** 固定东八区偏移。运营口径是北京时间，不能跟着浏览器时区漂。 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * ISO 字符串 → `2026-11-03 10:20:25`（固定东八区）。
 *
 * 与后端 `formatShanghai` 同口径：后台列表、抽屉、导出看到的都是同一时刻。
 * 直接 `slice(0, 19)` 截 ISO 字符串会把 UTC 当成本地时间显示，比北京时间
 * 少 8 小时 —— 对账「完成时间」这类要跟渠道账单对齐的字段尤其致命。
 */
export function formatShanghaiDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ` +
    `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
  );
}

/**
 * ISO 字符串 → `2026-11-03 10:20`（固定东八区，精确到分钟）。
 *
 * 列表列宽有限、要能扫读的场景用它；需要秒的用 {@link formatShanghaiDateTime}。
 */
export function formatShanghaiDateTimeShort(iso: string | null | undefined): string {
  const full = formatShanghaiDateTime(iso);
  return full === '—' ? full : full.slice(0, 16);
}

/** ISO 字符串 → `2026-11-03`（固定东八区）。与 {@link formatShanghaiDateTime} 同口径。 */
export function formatShanghaiDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** ISO 字符串 → `2026/11/02 14:03:12`。无法解析时原样返回（便于发现脏数据）。 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return displayDateTime(iso, String(iso));
}

/**
 * ISO 字符串 → 日期时间；空值与无法解析一律显示 `—`。
 * 列表与抽屉展示用这个口径，不把原始脏值暴露给运营。
 */
export function formatDateTimeLoose(iso: string | null | undefined): string {
  if (!iso) return '—';
  return displayDateTime(iso, '—');
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

/**
 * 分 → 裸金额文本（不带货币符号），例如 `12.34`。
 *
 * 表格单元格、表单回填与「¥{yuan(...)}」拼接场景由调用方决定符号，
 * 后台多数列表页用的是这个口径，不要换成 `formatYuan`。
 */
export function formatYuanPlain(cents: number): string {
  return (cents / 100).toFixed(2);
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
