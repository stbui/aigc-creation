import { EmptyState, Panel, StatusTag } from './components';
import { triggerLabel } from './utils';
import type { AdminCleanupLog } from '../../../types/api';

/** 清理留痕：到期数据清理不可逆，逐条记录删了多少、保留多少天 */
export function BackupCleanupLog({ logs }: { logs: AdminCleanupLog[] }) {
  return (
    <Panel title="清理留痕" note="到期数据清理是不可逆操作，全部留痕">
      {logs.length === 0 ? (
        <EmptyState title="暂无清理记录" />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {logs.map((log) => (
            <li key={log.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              <StatusTag
                status={log.success ? 'succeeded' : 'failed'}
                label={log.success ? '成功' : '失败'}
                tone={log.success ? 'success' : 'danger'}
              />
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">{log.target}</span>
              <span className="shrink-0 text-[12px] text-muted-foreground">
                删除 {log.deletedCount} 条 · 保留 {log.retentionDays} 天 ·{' '}
                {triggerLabel(log.trigger)}
              </span>
              <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                {new Date(log.createdAt).toLocaleString('zh-CN')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
