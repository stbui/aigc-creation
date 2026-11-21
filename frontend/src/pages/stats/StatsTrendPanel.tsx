import type { StatsOverview } from '../../types/api';
import { StateEmpty } from './components';
import { barHeightOf, weekdayOf, type TrendSummary } from './utils';

interface StatsTrendPanelProps {
  days: StatsOverview['last7Days'];
  summary: TrendSummary;
}

/** 柱体公共尺寸：宽度 60%、峰值封顶 44px */
const BAR_BASE = 'w-[60%] max-w-[44px] min-h-0.5';

/**
 * 柱体着色：
 * - 零值只留一条 1px 灰线，不参与悬停高亮；
 * - 今天常亮品牌色，其余日用 38% 品牌色，悬停时同样提到品牌色。
 */
function barToneClass(count: number, today: boolean): string {
  if (count === 0) return 'rounded-[1px] bg-[color:var(--border-hover)]';
  return today
    ? 'rounded-t-sm bg-brand'
    : 'rounded-t-sm bg-[color-mix(in_srgb,var(--brand)_38%,var(--card-bg))] transition-colors group-hover:bg-brand';
}

/** 近 7 天创作趋势：柱高按单日峰值归一。 */
export function StatsTrendPanel({ days, summary }: StatsTrendPanelProps) {
  const hasRecentOutput = summary.total > 0;

  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-border bg-card px-[18px] pt-4 pb-[18px]">
      <header className="flex min-h-7 items-center justify-between gap-3">
        <h4 className="m-0 text-sm font-semibold text-foreground">创作趋势</h4>
        {hasRecentOutput && (
          <span className="text-xs tabular-nums text-[color:var(--text-desc)]">
            峰值 {summary.peak} 次 · 共 {summary.total} 次
          </span>
        )}
      </header>
      {hasRecentOutput ? (
        <div
          className="flex min-h-[200px] flex-1 items-end gap-2 pt-3 max-[760px]:min-h-[160px]"
          role="img"
          aria-label={`近 7 天共创作 ${summary.total} 次，峰值 ${summary.peak} 次，活跃 ${summary.activeDays} 天`}
        >
          {days.map((day, index) => {
            const today = index === days.length - 1;
            return (
              <div
                key={day.date}
                className="group flex h-full min-w-0 flex-1 flex-col items-center gap-1.5"
              >
                <span className="min-h-4 text-xs leading-4 tabular-nums text-[color:var(--text-muted)]">
                  {day.count || ''}
                </span>
                <div className="flex w-full flex-1 items-end justify-center border-b border-[var(--border-row)]">
                  <span
                    className={`${BAR_BASE} ${barToneClass(day.count, today)}`}
                    style={{ height: `${barHeightOf(day.count, summary.peak)}%` }}
                    title={`${day.date}：${day.count} 次创作`}
                  />
                </div>
                <span
                  className={`flex flex-col items-center gap-px text-xs leading-4 whitespace-nowrap ${
                    today ? 'font-semibold text-brand' : 'text-[color:var(--text-muted)]'
                  }`}
                >
                  {weekdayOf(day.date)}
                  <em className="text-xs not-italic tabular-nums text-[color:var(--text-desc)] max-[760px]:hidden">
                    {day.date.slice(5)}
                  </em>
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
