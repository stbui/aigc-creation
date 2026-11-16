/**
 * 系统设置的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 * 新增引用时在这里补一行 re-export。
 */

import { SETTINGS_ROUTE_PREFIX, SETTINGS_TABS } from './constants';
import type {
  AdminSettingGroup,
  AdminSettingValue,
  SettingItem,
  SettingsTabKey,
} from './types';

export { formatDateTime } from '../../../admin-ui/lib/format';
export { UPLOAD_LIMITS_CHANGED_EVENT } from '../../../lib/api-settings';

export function displayValue(value: AdminSettingValue, type: SettingItem['type']): string {
  if (value === null) return '不限';
  if (type === 'boolean') return value ? '开启' : '关闭';
  return String(value);
}

/**
 * 分组副标题：说清这组「能改几项、几项已覆盖」，而不是重复页签上的总数。
 *
 * 全只读的分组单独给一句口径 —— 「0 项可编辑」读起来像出了故障。
 */
export function groupSummary(group: AdminSettingGroup): string {
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

export function isSettingsTabKey(value: string | undefined): value is SettingsTabKey {
  return SETTINGS_TABS.some((tab) => tab.value === value);
}

export function settingGroupPath(group: string): string {
  return `${SETTINGS_ROUTE_PREFIX}/${encodeURIComponent(group)}`;
}

/** 保存确认里逐项给出的生效时机，按配置键前缀归属到对应业务。 */
export function effectForSetting(key: string): string {
  if (key.startsWith('generate.')) return '下一轮账单清扫时生效（最长约 5 分钟）';
  if (key.startsWith('upload.')) return '下一次上传请求生效；已上传图片不受影响';
  if (key.startsWith('backup.')) return '下一次调度检查时生效（最长约 10 分钟）';
  return '保存后由对应业务在下次读取时生效';
}
