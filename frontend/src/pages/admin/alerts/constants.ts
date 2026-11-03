/**
 * AdminAlertsPage 的本地常量与类型。
 */

import type { AdminAlertSeverity } from '../../../types/api';

export const SEVERITY_SURFACE: Record<AdminAlertSeverity, { card: string; icon: string }> = {
  critical: { card: 'border-danger-soft bg-danger-soft/40', icon: 'text-danger-text' },
  warning: { card: 'border-warn-soft bg-warn-soft/40', icon: 'text-warn-text' },
  info: { card: 'border-border bg-card', icon: 'text-brand' },
};

export const SEVERITY_BADGE = {
  critical: 'danger',
  warning: 'warn',
  info: 'brand',
} as const;

export const SEVERITY_TONE: Record<AdminAlertSeverity, 'danger' | 'warn' | undefined> = {
  critical: 'danger',
  warning: 'warn',
  info: undefined,
};

export type SeverityFilter = 'all' | AdminAlertSeverity;
