/**
 * C 端展示层格式化 —— 日期、数字与金额的唯一入口。
 *
 * 金额由 `lib/money` 实现并从这里转出：页面只认本文件，避免同一类格式化
 * 在各页各写一份后出现取整或时区口径漂移。全部是纯函数，不碰 React。
 *
 * 无法解析的输入不回显 `Invalid Date`，统一回落到调用方给的 fallback。
 */

export { formatYuan } from './money';

/** ISO 字符串 → `2026/11/03 14:30`。 */
export function formatDateTime(
  iso: string | null | undefined,
  fallback = '—',
): string {
  if (!iso) return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** ISO 字符串 → `2026/11/03`。 */
export function formatDate(iso: string | null | undefined, fallback = '—'): string {
  if (!iso) return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/** 数字 → 千分位。非有限数回落到 fallback。 */
export function formatNumber(value: number | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return value.toLocaleString('zh-CN');
}

/**
 * ISO → `11/03 14:30`（本地时区，24 小时制）。同屏比较多个时刻时省略年份。
 *
 * `separator` 只切换日期段分隔符：表格、卡片沿用 `/`，空间紧的横条可用 `-`。
 */
export function formatCompactDateTime(
  iso: string | null | undefined,
  {
    withYear = false,
    separator = '/',
    fallback = '—',
  }: { withYear?: boolean; separator?: '/' | '-'; fallback?: string } = {},
): string {
  if (!iso) return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback;
  const text = date.toLocaleString('zh-CN', {
    ...(withYear ? { year: 'numeric' as const } : {}),
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return separator === '/' ? text : text.replace(/\//g, separator);
}

/** ISO → `刚刚` / `3 分钟前` / `5 小时前` / `11 月 3 日`。消息列表用相对时间更好读。 */
export function formatRelativeTime(
  iso: string | null | undefined,
  fallback = '',
  now = Date.now(),
): string {
  if (!iso) return fallback;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return fallback;
  const diff = now - time;
  const minute = 60_000;
  if (diff < minute) return '刚刚';
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  const date = new Date(time);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

/** ISO → `2026年11月03日`（本地时区）。会员到期这类只到日的长格式用它。 */
export function formatLongDate(
  iso: string | null | undefined,
  fallback = '—',
): string {
  if (!iso) return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Date → `14:30:05`（本地时区，24 小时制）。刷新时间戳这类同一会话内的时刻用它。 */
export function formatClock(date: Date | null | undefined, fallback = '—'): string {
  if (!date || Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
