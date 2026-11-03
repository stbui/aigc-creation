/**
 * AdminAlertsPage 的本地工具函数。
 */

import { SeverityFilter } from './constants';

export function readSeverity(raw: string | null): SeverityFilter {
  return raw === 'critical' || raw === 'warning' || raw === 'info' ? raw : 'all';
}
