import { ConfirmAction, FormField, TextField } from './components';
import type { AdminBackupStats } from '../../../types/api';

interface BackupRunConfirmProps {
  open: boolean;
  reason: string;
  reasonError: boolean;
  busy: boolean;
  stats: AdminBackupStats | null;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 手动备份确认：原因强制填写并写入审计 */
export function BackupRunConfirm({
  open,
  reason,
  reasonError,
  busy,
  stats,
  onReasonChange,
  onCancel,
  onConfirm,
}: BackupRunConfirmProps) {
  if (!open) return null;

  return (
    <ConfirmAction
      open
      title="立即备份"
      confirmText="开始备份"
      loading={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
      description={
        <p>
          将对当前数据库做一次全量快照，保存到服务器的备份目录。
          备份期间会短暂持有数据库写锁，其他写操作会排队等待。
        </p>
      }
      impact={[
        stats
          ? `当前已备份 ${stats.total} 份，占用 ${stats.totalMb} MB`
          : '将在备份完成后重新统计占用',
        '新备份初始状态为「未验证」，需再做一次恢复验证才能下载',
        '本次操作原因会写入操作审计',
      ]}
      extra={
        <FormField
          label="备份原因（强制，写入审计）："
          htmlFor="adm-backup-reason"
          required
          error={
            reasonError
              ? '请先填写原因，否则审计里无法回答「这次备份是谁为什么做的」。'
              : null
          }
        >
          <TextField
            value={reason}
            onChange={onReasonChange}
            placeholder="如：本周例行备份 / 改动结构前留档"
            maxLength={200}
            ariaLabel="备份原因"
          />
        </FormField>
      }
    />
  );
}
