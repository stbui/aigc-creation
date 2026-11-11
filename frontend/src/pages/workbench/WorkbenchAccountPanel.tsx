import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { CapabilityGroup, CreditBalance, StatsOverview } from '../../types/api';
import { groupNameOf, statusLabel } from './utils';
import { StateError, StateSkeleton } from './components';

/**
 * 账号和作品数据面板。
 *
 * 三格指标 + 最近任务表。未登录时只给登录入口，不发统计请求 ——
 * 加载 / 失败 / 无数据三态分开，失败可以原地重试。
 */
export interface WorkbenchAccountPanelProps {
  token: string | null;
  email: string | null;
  loading: boolean;
  error: string | null;
  stats: StatsOverview | null;
  balance: CreditBalance | null;
  groups: CapabilityGroup[];
  onRetry: () => void;
  onOpenLogin: () => void;
}

export function WorkbenchAccountPanel({
  token,
  email,
  loading,
  error,
  stats,
  balance,
  groups,
  onRetry,
  onOpenLogin,
}: WorkbenchAccountPanelProps) {
  const navigate = useNavigate();

  return (
    <article className="wb-panel wb-account">
      {!token ? (
        <div className="wb-login-prompt">
          <p>登录后查看可用积分和创作消费</p>
          <button type="button" onClick={onOpenLogin}>登录查看</button>
        </div>
      ) : (
        <>
          <div className="wb-panel-title">
            <strong>账号和作品数据</strong>
            <button type="button" onClick={() => navigate('/credits')}>
              积分明细 <ArrowRight size={12} />
            </button>
          </div>
          <div className="wb-user">
            <span className="wb-avatar">{(email?.[0] ?? 'U').toUpperCase()}</span>
            <span>{email}</span>
          </div>
          {loading ? (
            <StateSkeleton variant="panel" count={3} />
          ) : error ? (
            <StateError
              title="数据加载失败"
              desc="没能取回账号与作品数据。可能是后端未启动或网络异常，重试一次即可。"
              detail={error}
              onRetry={onRetry}
              compact
            />
          ) : stats ? (
            <>
              <div className="wb-account-metrics">
                <div>
                  <span>可用积分</span>
                  <b>{balance?.balance ?? '—'}</b>
                  <span>累计获得 {balance?.totalEarned ?? 0}</span>
                </div>
                <div>
                  <span>累计生成</span>
                  <b>{stats.totals.tasks}</b>
                  <span>成功率 {stats.totals.successRate === null ? '—' : `${stats.totals.successRate}%`}</span>
                </div>
                <div>
                  <span>素材库存</span>
                  <b>{stats.totals.assets}</b>
                  <span>原图 {stats.totals.originals} · 生成图 {stats.totals.generated}</span>
                </div>
              </div>
              <div className="wb-flow-head">
                <strong>最近任务</strong>
                <button type="button" onClick={() => navigate('/works')}>查看全部</button>
              </div>
              <div className="wb-flow-table-wrap">
                <table>
                  <thead>
                    <tr><th>时间</th><th>能力</th><th>业务类型</th><th>状态</th></tr>
                  </thead>
                  <tbody>
                    {stats.recentTasks.slice(0, 4).map((t) => (
                      <tr key={t.id}>
                        <td>{t.createdAt ? new Date(t.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}</td>
                        <td>{t.name}</td>
                        <td><span className="wb-flow-type expense">{groupNameOf(t.capability, groups)}</span></td>
                        <td>{statusLabel(t.status)}</td>
                      </tr>
                    ))}
                    {stats.recentTasks.length === 0 && <tr><td colSpan={4} className="wb-table-empty">暂无记录</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      )}
    </article>
  );
}
