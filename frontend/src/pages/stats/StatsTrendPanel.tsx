import type { StatsOverview } from '../../types/api';
import { StateEmpty } from './components';
import { barHeightOf, weekdayOf, type TrendSummary } from './utils';

interface StatsTrendPanelProps {
  days: StatsOverview['last7Days'];
  summary: TrendSummary;
}

/** 近 7 天创作趋势：柱高按单日峰值归一。 */
export function StatsTrendPanel({ days, summary }: StatsTrendPanelProps) {
  const hasRecentOutput = summary.total > 0;

  return (
    <article className="stats-panel">
      <header className="stats-panel-head">
        <h4 className="stats-panel-title">创作趋势</h4>
        {hasRecentOutput && (
          <span className="stats-panel-meta">
            峰值 {summary.peak} 次 · 共 {summary.total} 次
          </span>
        )}
      </header>
      {hasRecentOutput ? (
        <div
          className="stats-trend"
          role="img"
          aria-label={`近 7 天共创作 ${summary.total} 次，峰值 ${summary.peak} 次，活跃 ${summary.activeDays} 天`}
        >
          {days.map((day, index) => {
            const today = index === days.length - 1;
            return (
              <div key={day.date} className={`stats-trend-col${today ? ' is-today' : ''}`}>
                <span className="stats-trend-count">{day.count || ''}</span>
                <div className="stats-trend-track">
                  <span
                    className={`stats-trend-bar${day.count === 0 ? ' is-zero' : ''}`}
                    style={{ height: `${barHeightOf(day.count, summary.peak)}%` }}
                    title={`${day.date}：${day.count} 次创作`}
                  />
                </div>
                <span className="stats-trend-day">
                  {weekdayOf(day.date)}
                  <em>{day.date.slice(5)}</em>
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <StateEmpty
          compact
          title="近 7 天还没有创作"
          desc="完成一次创作后，这里会显示每天的创作趋势。"
        />
      )}
    </article>
  );
}
