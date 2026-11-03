/**
 * AdminFinancePage 的本地工具函数。
 */

export function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const start = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { from: isoDate(start), to: isoDate(today) };
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
