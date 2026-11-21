import type { StatsOverview } from '../../types/api';
import { assetThumbUrl } from './api';
import { StateEmpty } from './components';

interface StatsCapabilityPanelProps {
  capabilities: StatsOverview['byCapability'];
  /** 总创作次数：用于计算使用占比 */
  totalTasks: number;
}

/** 能力行与表头共用的三栏栅格；窄屏塌成「名称 + 次数」两栏，占比条占满下一行 */
const CAP_ROW =
  'grid grid-cols-[minmax(0,1fr)_120px_minmax(180px,260px)] items-center gap-4 max-[640px]:grid-cols-[minmax(0,1fr)_auto] max-[640px]:gap-x-3 max-[640px]:gap-y-2';

/** 缩略图占位与真图共用尺寸 */
const THUMB = 'block size-8 shrink-0 rounded-md bg-muted object-cover';

/** 常用能力：次数与使用占比（按总创作次数换算）。 */
export function StatsCapabilityPanel({ capabilities, totalTasks }: StatsCapabilityPanelProps) {
  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-border bg-card px-[18px] pt-4 pb-[18px]">
      <header className="flex min-h-7 items-center justify-between gap-3">
        <h4 className="m-0 text-sm font-semibold text-foreground">常用能力</h4>
        <span className="text-xs tabular-nums text-[color:var(--text-desc)]">
          {capabilities.length} 项能力用过
        </span>
      </header>
      {capabilities.length === 0 ? (
        <StateEmpty
          compact
          title="还没有创作记录"
          desc="使用任意能力完成创作后，这里会汇总你的常用能力。"
        />
      ) : (
        <div>
          <div
            className={`${CAP_ROW} border-b border-[var(--border-row)] py-2 text-xs text-[color:var(--text-desc)] max-[640px]:hidden`}
            aria-hidden
          >
            <span>能力</span>
            <span className="text-right">创作次数</span>
            <span className="text-right">使用占比</span>
          </div>
          <ul className="m-0 list-none p-0">
            {capabilities.map((capability) => {
              const share = totalTasks
                ? Math.round((capability.total / totalTasks) * 100)
                : 0;
              return (
                <li
                  key={capability.capability}
                  className={`${CAP_ROW} border-b border-[var(--border-row)] py-2.5 last:border-b-0 max-[640px]:py-3`}
                >
                  <span className="flex min-w-0 items-center gap-2.5 text-[13px] text-foreground">
                    {capability.thumbnailUrl ? (
                      <img
                        className={THUMB}
                        src={assetThumbUrl(capability.thumbnailUrl, 128)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className={THUMB} />
                    )}
                    <span className="truncate">{capability.name}</span>
                  </span>
                  <span className="flex items-baseline justify-end gap-1 tabular-nums">
                    <b className="text-[13px] font-semibold text-[color:var(--text-body)]">
                      {capability.total}
                    </b>
                    <em className="text-xs whitespace-nowrap not-italic text-[color:var(--text-desc)]">
                      次
                    </em>
                  </span>
                  <span className="flex min-w-0 items-center gap-2.5 max-[640px]:col-span-full">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <i className="block h-full rounded-full bg-brand" style={{ width: `${share}%` }} />
                    </span>
                    <em className="w-10 shrink-0 text-right text-xs not-italic tabular-nums text-[color:var(--text-body)]">
                      {share}%
                    </em>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </article>
  );
}
