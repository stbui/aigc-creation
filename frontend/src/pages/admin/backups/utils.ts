/**
 * 数据备份的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 */

import { formatBytes, formatRelative } from '../../../admin-ui/primitives';
import { BACKUP_STATUS_LABELS } from './constants';

export { formatBytes, formatRelative };

/** 备份状态文案；未终结的（running 等）统一读作「进行中」 */
export function backupStatusLabel(status: string): string {
  return BACKUP_STATUS_LABELS[status] ?? '进行中';
}

/** 触发方式：除 manual 以外都来自调度器 */
export function triggerLabel(trigger: string): string {
  return trigger === 'manual' ? '手动' : '自动';
}
