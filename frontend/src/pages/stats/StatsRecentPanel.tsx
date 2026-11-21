import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

import type { StatsOverview } from '../../types/api';
import { assetThumbUrl } from './api';
import { Button, StateEmpty } from './components';
import { TASK_STATUS, TASK_STATUS_TONE } from './constants';
import { formatTaskTime } from './utils';

interface StatsRecentPanelProps {
  tasks: StatsOverview['recentTasks'];
}

/** 缩略图占位与真图共用尺寸，缺图时不塌行 */
const THUMB = 'block size-10 shrink-0 rounded-md bg-muted object-cover';

/** 最近创作：缩略图 + 名称 + 状态，点击进入我的作品。 */
export function StatsRecentPanel({ tasks }: StatsRecentPanelProps) {
  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-border bg-card px-[18px] pt-4 pb-[18px]">
      <header className="flex min-h-7 items-center justify-between gap-3">
        <h4 className="m-0 text-sm font-semibold text-foreground">最近创作</h4>
        {tasks.length > 0 && (
          <Button asChild variant="link" size="sm">
            <Link to="/works">查看作品</Link>
          </Button>
        )}
      </header>
      {tasks.length === 0 ? (
        <StateEmpty
          compact
          title="暂无创作"
          desc="完成一次创作后，最近作品会出现在这里。"
          action={
            <Button asChild variant="ghost">
              <Link to="/workbench">去创作</Link>
            </Button>
          }
        />
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {tasks.map((task) => {
            const status = TASK_STATUS[task.status] ?? { label: task.status, tone: 'run' };
            return (
              <li key={task.id} className="border-b border-[var(--border-row)] last:border-b-0">
                <Link
                  className="group flex w-full items-center gap-2.5 rounded-md px-1.5 py-2 text-left text-inherit no-underline transition-colors hover:bg-[var(--surface-soft)] focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand"
                  to="/works"
                  aria-label={`查看 ${task.name} 作品`}
                >
                  {task.thumbnailUrl ? (
                    <img
                      className={THUMB}
                      src={assetThumbUrl(task.thumbnailUrl, 128)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span className={THUMB} />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[13px] leading-[18px] text-foreground">
                      {task.name}
                    </span>
                    <span className="text-xs leading-4 tabular-nums text-[color:var(--text-desc)]">
                      {formatTaskTime(task.createdAt)}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-px text-xs leading-[18px] font-semibold ${
                      TASK_STATUS_TONE[status.tone] ?? TASK_STATUS_TONE.muted
                    }`}
                  >
                    {status.label}
                  </span>
                  <ChevronRight
                    size={14}
                    className="shrink-0 text-[color:var(--text-desc)] transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-brand"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
