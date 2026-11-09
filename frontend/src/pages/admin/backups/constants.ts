import type { AdminBackup } from '../../../types/api';

/**
 * 数据备份的默认值与状态文案。
 *
 * 三条硬约束（B-97）：
 * 1. 未验证的备份不可下载；
 * 2. 手动备份必须填原因（`backup.run` 属高危权限）；
 * 3. 删除单份备份直接执行，确认弹窗只留给「保留份数清理」这种批量不可逆操作。
 */

/** 保留份数清理的默认值 */
export const DEFAULT_KEEP_COUNT = 7;

export const BACKUP_STATUS_LABELS: Record<string, string> = {
  succeeded: '成功',
  failed: '失败',
};

/**
 * 列表筛选维度。值即地址栏参数名，告警中心据此深链到「出问题的那几份」。
 *
 * - `status` —— 备份状态（成功 / 失败）；
 * - `verified` —— 恢复验证状态（已验证 / 未验证）。
 *
 * 告警「最近一次备份失败」要落到失败的那几行，「有备份尚未验证」要落到
 * 未验证的那几行 —— 没有筛选时这两条告警都只能把人丢到一个混着全部
 * 记录的列表里自己找。
 */
export const BACKUP_FILTER_OPTIONS = [
  { value: 'failed', label: '备份失败' },
  { value: 'succeeded', label: '备份成功' },
  { value: 'unverified', label: '未验证' },
  { value: 'verified', label: '已验证' },
] as const;

/** 地址栏参数 → 该参数对应的行判定 */
export const BACKUP_FILTER_PREDICATES: Record<string, (row: AdminBackup) => boolean> = {
  failed: (row) => row.status === 'failed',
  succeeded: (row) => row.status === 'succeeded',
  unverified: (row) => row.status === 'succeeded' && !row.verified,
  verified: (row) => row.status === 'succeeded' && row.verified,
};

/** 筛选值的可读标签，用于筛选回显 */
export const BACKUP_FILTER_LABELS: Record<string, string> = {
  failed: '备份失败',
  succeeded: '备份成功',
  unverified: '未验证',
  verified: '已验证',
};
