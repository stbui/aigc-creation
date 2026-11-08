/**
 * AdminSettingsPage 的本地工具函数。
 */

import type { AdminSettings, AdminSettingValue } from '../../../types/api';
import { SettingItem } from './constants';

export function displayValue(value: AdminSettingValue, type: SettingItem['type']): string {
  if (type === 'boolean') return value ? '开启' : '关闭';
  return String(value);
}

/**
 * 分组副标题：说清这组「能改几项、几项已覆盖」，而不是重复页签上的总数。
 *
 * 全只读的分组单独给一句口径 —— 「0 项可编辑」读起来像出了故障。
 */
export function groupSummary(group: AdminSettings['groups'][number]): string {
  const editable = group.items.filter((item) => !item.readOnly).length;
  const overridden = group.items.filter((item) => item.overridden).length;

  if (editable === 0) {
    return '本组配置为只读，仅展示当前值与默认值';
  }

  const parts = [`${editable} 项可编辑`];
  const readOnly = group.items.length - editable;
  if (readOnly > 0) parts.push(`${readOnly} 项只读`);
  if (overridden > 0) parts.push(`${overridden} 项已自定义`);
  return parts.join(' · ');
}
