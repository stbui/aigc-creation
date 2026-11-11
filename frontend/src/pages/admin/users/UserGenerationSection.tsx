import { Link } from 'react-router-dom';
import { DetailSection, EmptyState, MiniStat } from '~/admin-ui/primitives';
import { cn } from '~/admin-ui/lib/cn';
import type { AdminUserGeneration } from '../../../types/admin-users';
import { adminTasksHref } from './utils';

const MODALITY_LABEL: Record<string, string> = {
  image: '图像',
  video: '视频',
  text: '文本',
  audio: '音频',
};

function successRateClass(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground';
  if (rate >= 90) return 'text-success-text';
  if (rate >= 70) return 'text-warn-text';
  return 'text-danger-text';
}

/**
 * 用户详情中的生成概览。
 *
 * 任务量按「项目未软删」口径统计，与用户列表的任务数同源。趋势用 30 根
 * 日柱而不是折线：后台只需看出「哪天忙、哪天在失败」，不需要读精确刻度；
 * 每根柱子的 title 与 aria-label 保留完整数字。
 */
export function UserGenerationSection({
  generation,
  userId,
}: {
  generation: AdminUserGeneration;
  userId: string;
}) {
  const maxDaily = Math.max(...generation.trend.map((d) => d.total), 1);

  return (
    <div data-testid="admin-user-generation">
      <DetailSection title="生成" note={`近 30 天 ${generation.last30d.total} 次`}>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <dl className="grid grid-cols-4 divide-x divide-border/70 px-4">
            <MiniStat label="任务总数" value={String(generation.total)} />
            <MiniStat
              label="成功"
              value={String(generation.succeeded)}
              tone="success"
            />
            <MiniStat
              label="失败"
              value={String(generation.failed)}
              tone={generation.failed > 0 ? 'danger' : 'muted'}
            />
            <MiniStat
              label="成功率"
              value={
                generation.successRate === null
                  ? '—'
                  : `${generation.successRate}%`
              }
            />
          </dl>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">进行中</span>
            <span>
              运行{' '}
              <strong className="font-semibold text-foreground tabular-nums">
                {generation.running}
              </strong>
            </span>
            <span>
              排队{' '}
              <strong className="font-semibold text-foreground tabular-nums">
                {generation.queued}
              </strong>
            </span>
            <span>
              已取消{' '}
              <strong className="font-semibold text-foreground tabular-nums">
                {generation.cancelled}
              </strong>
            </span>
            <span className="ml-auto">
              近 30 天成功率{' '}
              <strong
                className={cn(
                  'font-semibold tabular-nums',
                  successRateClass(generation.last30d.successRate),
                )}
              >
                {generation.last30d.successRate === null
                  ? '—'
                  : `${generation.last30d.successRate}%`}
              </strong>
            </span>
          </div>
        </div>

        {generation.total === 0 ? (
          <EmptyState
            title="暂无生成记录"
            description="该用户提交生成任务后会显示在这里。"
            className="mt-2 border-0 px-4 py-6"
          />
        ) : (
          <>
            <div
              className="mt-3 flex h-16 items-end gap-[2px] rounded-md border border-border/70 bg-card px-2 py-2"
              role="img"
              aria-label={`近 30 天任务趋势：共 ${generation.last30d.total} 次，成功 ${generation.last30d.succeeded} 次，失败 ${generation.last30d.failed} 次`}
            >
              {generation.trend.map((day) => {
                const other = Math.max(
                  day.total - day.succeeded - day.failed,
                  0,
                );
                return (
                  <div
                    key={day.date}
                    className="flex h-full flex-1 flex-col justify-end"
                    title={`${day.date}：${day.total} 次（成功 ${day.succeeded} / 失败 ${day.failed}）`}
                  >
                    {other > 0 && (
                      <div
                        className="w-full bg-muted-foreground/30"
                        style={{ height: `${(other / maxDaily) * 100}%` }}
                      />
                    )}
                    {day.failed > 0 && (
                      <div
                        className="w-full bg-danger-text/70"
                        style={{ height: `${(day.failed / maxDaily) * 100}%` }}
                      />
                    )}
                    {day.succeeded > 0 && (
                      <div
                        className="w-full rounded-t-sm bg-brand/75"
                        style={{
                          height: `${(day.succeeded / maxDaily) * 100}%`,
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex items-center justify-between px-1 text-xs text-muted-foreground">
              <span>{generation.trend[0]?.date}</span>
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-brand/75" />
                  成功
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-danger-text/70" />
                  失败
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-muted-foreground/30" />
                  其他
                </span>
              </span>
              <span>
                {generation.trend[generation.trend.length - 1]?.date}
              </span>
            </div>

            {generation.byCapability.length > 0 && (
              <div className="mt-3">
                <h4 className="mb-1.5 text-[13px] font-medium text-foreground">
                  按能力
                </h4>
                <ul className="grid grid-cols-2 gap-x-5 gap-y-1">
                  {generation.byCapability.map((item) => (
                    <li
                      key={item.capability}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {item.capabilityName}
                        <span className="ml-1 text-muted-foreground">
                          {MODALITY_LABEL[item.modality] ?? item.modality}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {item.count} 次
                      </span>
                      <span
                        className={cn(
                          'w-12 shrink-0 text-right tabular-nums',
                          successRateClass(item.successRate),
                        )}
                      >
                        {item.successRate === null
                          ? '—'
                          : `${item.successRate}%`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        <div className="mt-2 text-right">
          <Link
            className="text-xs font-medium text-brand hover:underline"
            to={adminTasksHref({ userId })}
          >
            查看全部任务
          </Link>
        </div>
      </DetailSection>
    </div>
  );
}
