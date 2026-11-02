/**
 * 数据备份的默认值与状态文案。
 *
 * 三条硬约束（B-97）：
 * 1. 未验证的备份不可下载；
 * 2. 手动备份必须填原因（`backup.run` 属高危权限）；
 * 3. 删除单份备份直接执行，确认条只留给「保留份数清理」这种批量不可逆操作。
 */

/** 保留份数清理的默认值 */
export const DEFAULT_KEEP_COUNT = 7;

export const BACKUP_STATUS_LABELS: Record<string, string> = {
  succeeded: '成功',
  failed: '失败',
};
