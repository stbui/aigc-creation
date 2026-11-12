import type { StatsOverview } from '../../types/api';
import type { TrendSummary } from './utils';

interface StatsKpiGridProps {
  totals: StatsOverview['totals'];
  trend: TrendSummary;
}

/** 首屏 KPI：累计作品 / 创作次数 / 创作项目 / 近 7 天创作。 */
export function StatsKpiGrid({ totals, trend }: StatsKpiGridProps) {
  return (
    <section className="stats-kpis">
      <article className="stats-kpi">
        <span className="stats-kpi-label">累计作品</span>
        <span className="stats-kpi-value">{totals.generated}</span>
        <span className="stats-kpi-sub">可在「我的作品」中查看</span>
      </article>

      <article className="stats-kpi">
        <span className="stats-kpi-label">创作次数</span>
        <span className="stats-kpi-value">{totals.tasks}</span>
        <span className="stats-kpi-sub">
          已完成 <b>{totals.succeeded}</b>
        </span>
      </article>

      <article className="stats-kpi">
        <span className="stats-kpi-label">创作项目</span>
        <span className="stats-kpi-value">{totals.projects}</span>
        <span className="stats-kpi-sub">
          素材总量 <b>{totals.assets}</b>
        </span>
      </article>

      <article className="stats-kpi">
        <span className="stats-kpi-label">近 7 天创作</span>
        <span className="stats-kpi-value">{trend.total}</span>
        <span className="stats-kpi-sub">
          <span>
            活跃 <b>{trend.activeDays}</b> 天
          </span>
          <span>
            日均 <b>{trend.dailyAvg.toFixed(1)}</b>
          </span>
        </span>
      </article>
    </section>
  );
}
