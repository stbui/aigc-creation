import { StatCard } from '~/admin-ui/primitives';
import type { AdminTaskCongestion } from '../../../types/api';

/**
 * 任务监控顶部的运行水位。
 *
 * 这四张卡回答的是运营打开页面后的第一个问题：「现在有没有积压、有没有
 * 正在出错」。拥堵指标来自后端全量聚合，不随列表筛选变化；第一张卡则显示
 * 当前结果数，方便确认筛选是否命中。
 */
export function TaskStats({
  total,
  congestion,
  hasFilter,
  loading,
}: {
  total: number | null;
  congestion: AdminTaskCongestion | null;
  hasFilter: boolean;
  loading: boolean;
}) {
  const running = congestion?.running;
  const threshold = congestion?.runningThreshold;
  const overloaded = running !== undefined && threshold !== undefined && running > threshold;

  return (
    <div className="mb-3 grid grid-cols-4 gap-3">
      <StatCard
        label={hasFilter ? '筛选结果' : '任务总量'}
        value={loading && total === null ? '—' : (total ?? '—')}
        hint={hasFilter ? '按当前条件命中' : '全部生成任务'}
      />
      <StatCard
        label="排队中"
        value={congestion?.queued ?? '—'}
        hint="等待调度与并发名额"
      />
      <StatCard
        label="执行中"
        value={running ?? '—'}
        hint={threshold !== undefined ? `告警阈值 ${threshold}` : '等待任务量刷新'}
        tone={overloaded ? 'warn' : undefined}
      />
      <StatCard
        label="近 1 小时失败"
        value={congestion?.failedLastHour ?? '—'}
        hint={congestion?.failedLastHour ? '建议优先排查失败原因' : '暂无新增失败'}
        tone={congestion?.failedLastHour ? 'danger' : undefined}
      />
    </div>
  );
}
