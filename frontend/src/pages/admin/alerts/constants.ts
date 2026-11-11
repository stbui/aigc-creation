/**
 * AdminAlertsPage 的本地常量与类型。
 */

import type { AdminAlertItem, AdminAlertSeverity } from '../../../types/api';

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

/**
 * 统计卡副文案：同一级别在「有数」和「归零」两种状态下说的不是一句话。
 *
 * 把口径原文常驻在 0 条卡片上会自相矛盾 ——「需处理 0 / 已有用户可见影响」。
 */
export const SEVERITY_HINT: Record<AdminAlertSeverity, { some: string; none: string }> = {
  critical: { some: '涉及资金或服务可用性，尽快处理', none: '无资金与可用性问题' },
  warning: { some: '已有用户可见影响', none: '无用户可见影响' },
  info: { some: '建议核对，不阻断运营', none: '暂无需核对项' },
};

/**
 * 告警来源 → 人话。
 *
 * 后端在 `AdminAlertItem.category` 里给了来源模块，页面此前没消费 ——
 * 结果六类告警长得一模一样，运营只能从标题文字里反推是工单还是对账。
 * 用行内小字前缀而不是第二枚 badge：级别 badge 已经占了标题行，
 * 再叠一枚会把标题挤断。
 */
export const ALERT_CATEGORY_LABEL: Record<AdminAlertItem['category'], string> = {
  ticket: '工单',
  task: '任务',
  finance: '对账',
  backup: '备份',
  invoice: '发票',
};

export type SeverityFilter = 'all' | AdminAlertSeverity;
