import { ConfirmAction } from '~/admin-ui/primitives';
import type { AdminBackupStats } from '../../../types/api';

interface BackupRunConfirmProps {
  open: boolean;
  busy: boolean;
  stats: AdminBackupStats | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 手动备份确认：审计原因由页面按操作上下文生成 */
export function BackupRunConfirm({
  open,
  busy,
  stats,
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
        '本次操作会写入操作审计',
      ]}
    />
  );
}
