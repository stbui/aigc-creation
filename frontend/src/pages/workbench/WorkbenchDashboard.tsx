import type { StatsOverview } from '../../types/api';
import { DASH_TILES } from './constants';
import { StateError, StateSkeleton } from './components';

/**
 * 数据看板：6 格指标 + 近 7 天产出柱图。
 *
 * 数值全部来自真实统计接口，无占位数字。柱高以近 7 天最大值为基准归一化，
 * 全 0 时用 1 兜底避免除零。
 */
export interface WorkbenchDashboardProps {
  token: string | null;
  loading: boolean;
  error: string | null;
  stats: StatsOverview | null;
  onRetry: () => void;
  onOpenLogin: () => void;
}

export function WorkbenchDashboard({
  token,
  loading,
  error,
  stats,
  onRetry,
  onOpenLogin,
}: WorkbenchDashboardProps) {
  const max7d = Math.max(1, ...(stats?.last7Days ?? []).map((d) => d.count));

  return (
    <section className="wb-panel wb-dashboard" aria-labelledby="wb-dashboard-title">
      {!token ? (
        <div className="wb-login-prompt">
          <p>登录后查看创作数据</p>
          <button type="button" onClick={onOpenLogin}>登录查看</button>
        </div>
      ) : (
        <>
          <div className="wb-dashboard-head">
            <div>
              <strong id="wb-dashboard-title">数据看板</strong>
              <span>统计区间：近 7 天</span>
            </div>
          </div>
          {loading ? (
            <StateSkeleton variant="panel" count={4} />
          ) : error ? (
            <StateError title="数据加载失败" desc="没能取回创作数据。可能是后端未启动或网络异常，重试一次即可。" onRetry={onRetry} compact />
          ) : stats ? (
            <>
              <div className="wb-dashboard-stats">
                {DASH_TILES.map((t) => (
                  <div key={t.label}>
                    <span>{t.label}</span>
                    <b>{t.value(stats)}</b>
                  </div>
                ))}
              </div>
              <div className="wb-chart-title">每日产出（近 7 天）</div>
              <div className="wb-trend-chart">
                {stats.last7Days.map((d) => (
                  <div key={d.date} className="wb-trend-col">
                    <span className="wb-trend-count">{d.count > 0 ? d.count : ''}</span>
                    <span className="wb-trend-bar-wrap">
                      <span className="wb-trend-bar" style={{ height: `${Math.round((d.count / max7d) * 100)}%` }} />
                    </span>
                    <span className="wb-trend-date">{d.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
