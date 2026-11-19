import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { StatsOverview } from '../../types/api';
import { assetThumbUrl } from './api';
import { formatCompactDateTime, statusLabel } from './utils';
import { CapabilityIcon, StateError, StateSkeleton } from './components';

/**
 * 最近任务面板。
 *
 * 最多 4 条，缩略图取任务快照；没有记录时给去工作台的提示，不是空白面板。
 */
export interface WorkbenchRecentPanelProps {
  token: string | null;
  loading: boolean;
  error: string | null;
  stats: StatsOverview | null;
  onRetry: () => void;
  onOpenLogin: () => void;
}

export function WorkbenchRecentPanel({
  token,
  loading,
  error,
  stats,
  onRetry,
  onOpenLogin,
}: WorkbenchRecentPanelProps) {
  return (
    <article className="wb-panel wb-recent">
      {!token ? (
        <div className="wb-login-prompt">
          <p>登录后保存和查看最近任务</p>
          <button type="button" onClick={onOpenLogin}>登录查看</button>
        </div>
      ) : (
        <>
          <div className="wb-panel-title">
            <strong>最近任务</strong>
            <Link to="/works">
              全部作品 <ArrowRight size={12} aria-hidden />
            </Link>
          </div>
          {loading ? (
            <StateSkeleton variant="row" count={3} />
          ) : error ? (
            <StateError title="加载失败" desc="没能取回最近任务列表。" onRetry={onRetry} compact />
          ) : stats && stats.recentTasks.length > 0 ? (
            <div className="wb-jobs-list">
              {stats.recentTasks.slice(0, 4).map((t) => (
                <Link key={t.id} className="wb-job" to="/works">
                  <span className="wb-job-thumb">
                    {t.thumbnailUrl ? <img src={assetThumbUrl(t.thumbnailUrl, 96)} alt="" loading="lazy" /> : <CapabilityIcon id={t.capability} size={18} />}
                  </span>
                  <span className="wb-job-copy">
                    <b>{t.name}</b>
                    <span>{formatCompactDateTime(t.createdAt, { fallback: '' })}</span>
                  </span>
                  <span className={`wb-job-status ${t.status === 'succeeded' ? 'completed' : t.status === 'failed' ? 'failed' : 'processing'}`}>{statusLabel(t.status)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="wb-jobs-empty">还没有生成记录，去工作台创建第一条</div>
          )}
        </>
      )}
    </article>
  );
}
