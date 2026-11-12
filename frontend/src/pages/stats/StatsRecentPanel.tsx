import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

import type { StatsOverview } from '../../types/api';
import { assetThumbUrl } from './api';
import { Button, StateEmpty } from './components';
import { TASK_STATUS } from './constants';
import { formatTaskTime } from './utils';

interface StatsRecentPanelProps {
  tasks: StatsOverview['recentTasks'];
}

/** 最近创作：缩略图 + 名称 + 状态，点击进入我的作品。 */
export function StatsRecentPanel({ tasks }: StatsRecentPanelProps) {
  const navigate = useNavigate();

  return (
    <article className="stats-panel">
      <header className="stats-panel-head">
        <h4 className="stats-panel-title">最近创作</h4>
        {tasks.length > 0 && (
          <Button type="link" size="small" onClick={() => navigate('/works')}>
            查看作品
          </Button>
        )}
      </header>
      {tasks.length === 0 ? (
        <StateEmpty
          compact
          title="暂无创作"
          desc="完成一次创作后，最近作品会出现在这里。"
          action={
            <Button type="text" onClick={() => navigate('/workbench')}>
              去创作
            </Button>
          }
        />
      ) : (
        <ul className="stats-recent">
          {tasks.map((task) => {
            const status = TASK_STATUS[task.status] ?? { label: task.status, tone: 'run' };
            return (
              <li key={task.id}>
                <button
                  type="button"
                  className="stats-recent-row"
                  onClick={() => navigate('/works')}
                  aria-label={`查看 ${task.name} 作品`}
                >
                  {task.thumbnailUrl ? (
                    <img
                      className="stats-recent-thumb"
                      src={assetThumbUrl(task.thumbnailUrl, 128)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span className="stats-recent-thumb is-empty" />
                  )}
                  <span className="stats-recent-main">
                    <span className="stats-recent-name">{task.name}</span>
                    <span className="stats-recent-time">{formatTaskTime(task.createdAt)}</span>
                  </span>
                  <span className={`stats-task-status is-${status.tone}`}>{status.label}</span>
                  <ChevronRight size={14} className="stats-recent-arrow" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
