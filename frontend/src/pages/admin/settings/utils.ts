/**
 * AdminSettingsPage 的本地工具函数。
 */

import type { AdminSettings, AdminSettingValue } from '../../../types/api';
import { SettingItem } from './constants';

export function displayValue(value: AdminSettingValue, type: SettingItem['type']): string {
  if (type === 'boolean') return value ? '开启' : '关闭';
  return String(value);
}
