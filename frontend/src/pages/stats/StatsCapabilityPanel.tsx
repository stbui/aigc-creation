import type { StatsOverview } from '../../types/api';
import { assetThumbUrl } from './api';
import { StateEmpty } from './components';

interface StatsCapabilityPanelProps {
  capabilities: StatsOverview['byCapability'];
  /** 总创作次数：用于计算使用占比 */
  totalTasks: number;
}

/** 常用能力：次数与使用占比（按总创作次数换算）。 */
export function StatsCapabilityPanel({ capabilities, totalTasks }: StatsCapabilityPanelProps) {
  return (
    <article className="stats-panel">
      <header className="stats-panel-head">
        <h4 className="stats-panel-title">常用能力</h4>
        <span className="stats-panel-meta">{capabilities.length} 项能力用过</span>
      </header>
      {capabilities.length === 0 ? (
        <StateEmpty
          compact
          title="还没有创作记录"
          desc="使用任意能力完成创作后，这里会汇总你的常用能力。"
        />
      ) : (
        <div className="stats-caps">
          <div className="stats-caps-head" aria-hidden>
            <span>能力</span>
            <span>创作次数</span>
            <span>使用占比</span>
          </div>
          <ul className="stats-caps-list">
            {capabilities.map((capability) => {
              const share = totalTasks
                ? Math.round((capability.total / totalTasks) * 100)
                : 0;
              return (
                <li key={capability.capability} className="stats-cap">
                  <span className="stats-cap-name">
                    {capability.thumbnailUrl ? (
                      <img
                        className="stats-cap-thumb"
                        src={assetThumbUrl(capability.thumbnailUrl, 128)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className="stats-cap-thumb is-empty" />
                    )}
                    <span className="stats-cap-text">{capability.name}</span>
                  </span>
                  <span className="stats-cap-count">
                    <b>{capability.total}</b>
                    <em>次</em>
                  </span>
                  <span className="stats-cap-share">
                    <span className="stats-cap-bar">
                      <i style={{ width: `${share}%` }} />
                    </span>
                    <em>{share}%</em>
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
