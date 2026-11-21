import type { StatsOverview } from '../../types/api';
import type { TrendSummary } from './utils';

interface StatsKpiGridProps {
  totals: StatsOverview['totals'];
  trend: TrendSummary;
}

/** 卡内副行的数字：比说明文字深一档，等宽对齐 */
const SUB_VALUE = 'font-semibold tabular-nums text-[color:var(--text-body)]';

/** 首屏 KPI：累计作品 / 创作次数 / 创作项目 / 近 7 天创作。 */
export function StatsKpiGrid({ totals, trend }: StatsKpiGridProps) {
  return (
    <section className="grid grid-cols-4 gap-3 max-[760px]:grid-cols-2">
      <article className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card px-[18px] py-4 max-[760px]:px-4 max-[760px]:py-3.5">
        <span className="text-[13px] text-[color:var(--text-muted)]">累计作品</span>
        <span className="text-[30px] leading-[1.15] font-bold tabular-nums text-foreground max-[760px]:text-[26px]">
          {totals.generated}
        </span>
        <span className="text-xs leading-[18px] text-[color:var(--text-desc)]">
          可在「我的作品」中查看
        </span>
      </article>

      <article className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card px-[18px] py-4 max-[760px]:px-4 max-[760px]:py-3.5">
        <span className="text-[13px] text-[color:var(--text-muted)]">创作次数</span>
        <span className="text-[30px] leading-[1.15] font-bold tabular-nums text-foreground max-[760px]:text-[26px]">
          {totals.tasks}
        </span>
        <span className="text-xs leading-[18px] text-[color:var(--text-desc)]">
          已完成 <b className={SUB_VALUE}>{totals.succeeded}</b>
        </span>
      </article>

      <article className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card px-[18px] py-4 max-[760px]:px-4 max-[760px]:py-3.5">
        <span className="text-[13px] text-[color:var(--text-muted)]">创作项目</span>
        <span className="text-[30px] leading-[1.15] font-bold tabular-nums text-foreground max-[760px]:text-[26px]">
          {totals.projects}
        </span>
        <span className="text-xs leading-[18px] text-[color:var(--text-desc)]">
          素材总量 <b className={SUB_VALUE}>{totals.assets}</b>
        </span>
      </article>

      <article className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card px-[18px] py-4 max-[760px]:px-4 max-[760px]:py-3.5">
        <span className="text-[13px] text-[color:var(--text-muted)]">近 7 天创作</span>
        <span className="text-[30px] leading-[1.15] font-bold tabular-nums text-foreground max-[760px]:text-[26px]">
          {trend.total}
        </span>
        <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs leading-[18px] text-[color:var(--text-desc)]">
          <span>
            活跃 <b className={SUB_VALUE}>{trend.activeDays}</b> 天
          </span>
          <span>
            日均 <b className={SUB_VALUE}>{trend.dailyAvg.toFixed(1)}</b>
          </span>
        </span>
      </article>
    </section>
  );
}
