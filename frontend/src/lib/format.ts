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
  return date.toLocaleDateString('zh-CN');
}

/** 数字 → 千分位。非有限数回落到 fallback。 */
export function formatNumber(value: number | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return value.toLocaleString('zh-CN');
}
