import { ShieldAlert } from 'lucide-react';
import { Notice, StatCard } from './components';
import { formatRelative } from './utils';
import type { AdminBackupStats } from '../../../types/api';

/**
 * 备份健康度：过期、未验证、失败三类问题直接对应「出事时能不能用」。
 */
export function BackupHealth({ stats }: { stats: AdminBackupStats | null }) {
  if (!stats) return null;

  return (
    <>
      {(stats.stale || stats.unverified > 0 || stats.failed > 0) && (
        <Notice
          tone="warn"
          title="备份健康度需要处理"
          icon={<ShieldAlert className="size-4" aria-hidden />}
        >
          {stats.stale && <div>超过 24 小时没有成功备份，请检查调度器是否运行。</div>}
          {stats.unverified > 0 && (
            <div>
              有 {stats.unverified} 份备份未经恢复验证，事故时可能无法使用，请尽快验证。
            </div>
          )}
          {stats.failed > 0 && <div>有 {stats.failed} 次备份失败，请在操作审计中查看原因。</div>}
        </Notice>
      )}

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label="备份份数"
          value={stats.total}
          hint={`成功 ${stats.succeeded} · 失败 ${stats.failed}`}
        />
        <StatCard label="已验证" value={stats.verified} hint="通过恢复验证的份数" />
        <StatCard
          label="未验证"
          value={stats.unverified}
          hint="不可下载"
          tone={stats.unverified > 0 ? 'warn' : undefined}
        />
        <StatCard label="占用空间" value={stats.totalMb} hint="MB" />
        <StatCard
          label="最近成功备份"
          value={<span className="text-[18px]">{formatRelative(stats.lastSuccessAt)}</span>}
          hint={
            stats.lastSuccessAt
              ? new Date(stats.lastSuccessAt).toLocaleString('zh-CN')
              : '从未成功备份'
          }
        />
      </div>
    </>
  );
}
