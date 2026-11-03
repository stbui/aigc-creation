/**
 * AdminRetentionPage 的本地工具函数。
 */

export function fmtTime(v: string | null): string {
  return v ? new Date(v).toLocaleString('zh-CN') : '—';
}
