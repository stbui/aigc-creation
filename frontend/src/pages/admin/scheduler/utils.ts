/**
 * AdminSchedulerPage 的本地工具函数。
 */

import type { AdminSchedulerTask } from '../../../types/api';

export function since(iso: string | null): string {
  if (!iso) return '从未执行';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export function freshness(t: AdminSchedulerTask): 'ok' | 'failed' | 'never' {
  if (t.consecutiveFailures > 0) return 'failed';
  if (!t.lastRunAt) return 'never';
  return 'ok';
}
