/**
 * AdminSettingsPage 的本地常量与类型。
 */

import type { AdminSettings } from '../../../types/api';

export type SettingItem = AdminSettings['groups'][number]['items'][number];
export type SettingsTabKey = 'generate' | 'upload' | 'backup' | 'security';

/** 系统设置下各配置分组的独立路由。 */
export const SETTINGS_ROUTE_PREFIX = '/admin/settings';

/** 已拆成独立工作台、不再出现在系统设置页签中的配置域。 */
export const HIDDEN_SETTING_GROUP_KEYS = new Set([
  'email',
  'payment',
  'refund',
  'retention',
]);

export const SETTINGS_TABS: ReadonlyArray<{ value: SettingsTabKey; label: string }> = [
  { value: 'generate', label: '运行与生成' },
  { value: 'upload', label: '上传限制' },
  { value: 'backup', label: '备份' },
  { value: 'security', label: '安全' },
];

export function isSettingsTabKey(value: string | undefined): value is SettingsTabKey {
  return SETTINGS_TABS.some((tab) => tab.value === value);
}

export function settingGroupPath(group: string): string {
  return `${SETTINGS_ROUTE_PREFIX}/${encodeURIComponent(group)}`;
}
