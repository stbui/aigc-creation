import { useCallback, useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  EmptyState,
  ListError,
  Meter,
  Notice,
  Panel,
  RefreshButton,
  SkeletonCards,
  SkeletonPanel,
  StaleError,
  StatCards,
  cn,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatRelative,
} from './components';
import { adminSystemPerformanceApi } from './api';
import { useAdminResource } from './hooks';
import type { AdminSystemPerformance } from './types';

/**
 * 系统性能（`/admin/settings/performance`）。
 *
 * 只读快照。数字全部来自后端 `SystemPerformanceService`，页面不做二次聚合 ——
 * 同一指标两处计算迟早和告警、财务页对不上。没有样本的耗时（P95 / 上次执行）
 * 一律显示「—」，不能写 0：值班时 0ms 会被读成「快得没问题」。
 *
 * 有快照后每 30 秒静默刷新：进程内存与事件循环延迟是瞬时量，看一次旧值
 * 意义不大；轮询走 silent，避免刷新按钮自己不停转圈。
 */
export function SettingsPerformanceTab() {
  const fetcher = useCallback(() => adminSystemPerformanceApi.read(), []);
  const { data, loading, error, reload } = useAdminResource<AdminSystemPerformance>(fetcher, []);

  /*
   * 30 秒静默刷新。页面隐藏时暂停：后台开着的标签页不该持续给进程探针压力。
   */
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void reload({ silent: true });
    }, 30_000);
    return () => clearInterval(timer);
  }, [reload]);

  if (loading && !data) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4">
        <div className="min-w-0">
          <SkeletonCards count={4} />
          <SkeletonPanel rows={4} />
          <SkeletonPanel rows={4} />
        </div>
        <div className="flex flex-col gap-4">
          <SkeletonPanel rows={3} className="mb-0" />
          <SkeletonPanel rows={4} className="mb-0" />
        </div>
      </div>
    );
  }
  if (error && !data) return <ListError error={error} onRetry={() => void reload()} />;
  if (!data) return <EmptyState title="暂无性能数据" />;

  const { runtime, database, storage, traffic } = data;
  const failedSchedulers = data.scheduler.tasks.filter((task) => task.consecutiveFailures > 0);
  const heapPct =
    runtime.memory.heapTotalBytes > 0
      ? Math.round((runtime.memory.heapUsedBytes / runtime.memory.heapTotalBytes) * 100)
      : 0;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4">
      <div className="min-w-0">
        {error && <StaleError error={error} onRetry={() => void reload()} />}

        {!database.ok && (
          <Notice tone="danger" title="数据库探活失败">
            <p>{database.message ?? '本次 SELECT 1 没有返回，先检查库文件与磁盘。'}</p>
          </Notice>
        )}
        {failedSchedulers.length > 0 && (
          <Notice tone="warn" title={`${failedSchedulers.length} 个定时任务连续失败`}>
            <p>
              {failedSchedulers
                .map((task) => `${task.label}（${task.consecutiveFailures} 次）`)
                .join('、')}
              。调度器不会因单个任务失败而停止其它任务，但该任务已停止生效。
            </p>
          </Notice>
        )}

        <StatCards
          columns={4}
          className="mb-3"
          items={[
            {
              label: '事件循环延迟',
              value: `${runtime.eventLoopLagMs.toFixed(1)} ms`,
              hint: '同步阻塞会显著抬高',
              tone:
                runtime.eventLoopLagMs > 100
                  ? 'danger'
                  : runtime.eventLoopLagMs > 20
                    ? 'warn'
                    : undefined,
            },
            {
              label: '数据库探活',
              value: database.ok ? `${database.latencyMs} ms` : '失败',
              hint:
                database.fileBytes === null
                  ? '非本地文件库'
                  : `库文件 ${formatBytes(database.fileBytes)}`,
              tone: database.ok ? undefined : 'danger',
            },
            {
              label: '存储探活',
              value: storage.ok ? `${storage.latencyMs} ms` : '不可用',
              hint: storage.cached ? `${storage.backend} · 30 秒内缓存` : storage.backend,
              tone: storage.ok ? undefined : 'danger',
            },
            {
              label: '24h 任务成功率',
              value: pct(traffic.tasks.successRate),
              hint: `${formatNumber(traffic.tasks.succeeded)} 成功 / ${formatNumber(traffic.tasks.failed)} 失败`,
              tone:
                traffic.tasks.successRate === null
                  ? undefined
                  : traffic.tasks.successRate < 0.9
                    ? 'danger'
                    : traffic.tasks.successRate < 0.98
                      ? 'warn'
                      : undefined,
            },
          ]}
        />

        <Panel title="运行时" note="本进程 · 快照点即瞬时值">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-[12px] leading-5">
            <Metric label="环境" value={runtime.env} />
            <Metric label="版本 / Node" value={`${runtime.version} · ${runtime.node}`} />
            <Metric label="已运行" value={formatDuration(runtime.uptimeSec * 1000)} />
            <Metric label="进程 PID" value={String(runtime.pid)} />
            <Metric
              label="CPU 累计时间"
              value={`用户 ${formatDuration(runtime.cpu.userMs)} · 系统 ${formatDuration(runtime.cpu.systemMs)}`}
              hint={`${runtime.cpu.cores} 核`}
            />
            <Metric
              label="内存 RSS"
              value={formatBytes(runtime.memory.rssBytes)}
              hint={`堆 ${formatBytes(runtime.memory.heapUsedBytes)} / ${formatBytes(runtime.memory.heapTotalBytes)}`}
            />
          </div>
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-[12px] text-radar-ink-500">
              <span>堆使用率</span>
              <span className="tabular-nums text-radar-ink-900">{heapPct}%</span>
            </div>
            <Meter
              value={heapPct}
              tone={heapPct >= 90 ? 'danger' : heapPct >= 75 ? 'warn' : 'success'}
              label={`堆使用率 ${heapPct}%`}
            />
          </div>
        </Panel>

        <Panel title="近 24 小时任务与调用" note="耗时为终态样本 P95（最近邻法，不插值）">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-[12px] leading-5">
            <Metric
              label="任务总量"
              value={formatNumber(traffic.tasks.total)}
              hint={`成功 ${formatNumber(traffic.tasks.succeeded)} · 失败 ${formatNumber(traffic.tasks.failed)}`}
            />
            <Metric label="任务 P95 耗时" value={durationOrDash(traffic.tasks.p95DurationMs)} />
            <Metric
              label="上游调用"
              value={formatNumber(traffic.calls.total)}
              hint={`终态 ${formatNumber(traffic.calls.terminal)} · 失败 ${formatNumber(traffic.calls.failed)}`}
            />
            <Metric label="调用 P95 耗时" value={durationOrDash(traffic.calls.p95DurationMs)} />
            <Metric
              label="素材总量"
              value={`${formatNumber(traffic.storage.assets)} 个 · ${formatBytes(traffic.storage.bytes)}`}
            />
            <Metric
              label="线路冷却"
              value={`${formatNumber(traffic.cooling.blocked)} 条`}
              hint={
                traffic.cooling.blocked > 0
                  ? traffic.cooling.keys.map((key) => key.key).join('、')
                  : '没有线路处于冷却'
              }
              tone={traffic.cooling.blocked > 0 ? 'warn' : undefined}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-radar-ink-500">
            <span>任务状态：{countSummary(traffic.tasks.byStatus)}</span>
            <span>调用类型：{countSummary(traffic.calls.byKind)}</span>
          </div>
        </Panel>

        <Panel title="定时任务" note="每次快照读取调度器当前状态">
          {data.scheduler.tasks.length === 0 ? (
            <EmptyState title="调度器尚未执行过任务" />
          ) : (
            <div className="flex flex-col divide-y divide-radar-ink-100">
              {data.scheduler.tasks.map((task) => (
                <div key={task.name} className="flex items-center gap-3 py-2 text-[12px] leading-5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-radar-ink-900">{task.label}</div>
                    <div className="text-radar-ink-500">
                      {task.lastRunAt ? `上次 ${formatRelative(task.lastRunAt)}` : '从未执行'}
                      {task.totalRuns > 0 ? ` · 共 ${task.totalRuns} 次` : ''}
                    </div>
                  </div>
                  <div className="w-24 shrink-0 text-right tabular-nums text-radar-ink-700">
                    {durationOrDash(task.lastDurationMs)}
                  </div>
                  <div
                    className={cn(
                      'w-16 shrink-0 text-right text-[12px]',
                      task.consecutiveFailures > 0
                        ? 'font-medium text-radar-alert'
                        : 'text-radar-ink-400',
                    )}
                  >
                    {task.consecutiveFailures > 0
                      ? `连续失败 ${task.consecutiveFailures}`
                      : '正常'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <aside className="sticky top-4 flex flex-col gap-4" aria-label="系统性能说明">
        <Panel title="口径与刷新" note={formatDateTime(data.generatedAt)} className="mb-0">
          <ul className="flex flex-col gap-2 text-[12px] leading-5 text-muted-foreground">
            <li>快照采集耗时 {data.durationMs} ms；页面打开后每 30 秒静默刷新一次。</li>
            <li>
              数据库探活每次真实执行一次 <code className="rounded bg-muted px-1">SELECT 1</code>
              ，不是读进程内标记。
            </li>
            <li>存储探活 30 秒内复用上一次结果，避免刷新把云存储变成探针压力源。</li>
            <li>
              任务耗时 = 终态任务的 <code className="rounded bg-muted px-1">updatedAt - createdAt</code>
              ；调用耗时取终态样本。
            </li>
            <li>没有样本显示「—」，不写 0。</li>
          </ul>
        </Panel>

        <Panel title="排障入口" note="看到异常下一步去哪里" className="mb-0">
          <ul className="flex flex-col gap-2 text-[12px] leading-5">
            <li>
              <Link
                className="text-radar-ink-950 underline-offset-2 hover:underline"
                to="/admin/alerts"
              >
                告警中心
              </Link>
              <span className="text-muted-foreground"> · 失败任务 / 待核对账单 / 备份</span>
            </li>
            <li>
              <Link
                className="text-radar-ink-950 underline-offset-2 hover:underline"
                to="/admin/model-calls"
              >
                调用记录
              </Link>
              <span className="text-muted-foreground"> · 逐次上游请求与耗时</span>
            </li>
            <li>
              <Link
                className="text-radar-ink-950 underline-offset-2 hover:underline"
                to="/admin/scheduler"
              >
                定时任务
              </Link>
              <span className="text-muted-foreground"> · 手动触发幂等任务</span>
            </li>
            <li>
              <Link
                className="text-radar-ink-950 underline-offset-2 hover:underline"
                to="/admin/storage"
              >
                存储配置
              </Link>
              <span className="text-muted-foreground"> · 后端连通与容量</span>
            </li>
          </ul>
        </Panel>

        <Panel title="刷新" note="不会写任何配置" className="mb-0">
          <RefreshButton loading={loading} onRefresh={reload} />
        </Panel>
      </aside>
    </div>
  );
}

function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function durationOrDash(ms: number | null): string {
  return ms === null ? '—' : formatDuration(ms);
}

function countSummary(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return '—';
  return entries
    .sort((left, right) => right[1] - left[1])
    .map(([key, count]) => `${key} ${count}`)
    .join(' · ');
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'success' | 'danger' | 'warn';
}) {
  return (
    <div className="min-w-0">
      <div className="text-radar-ink-500">{label}</div>
      <div
        className={cn(
          'mt-0.5 text-[13px] font-medium tabular-nums text-radar-ink-900',
          tone === 'danger' && 'text-radar-alert',
          tone === 'warn' && 'text-radar-code',
          tone === 'success' && 'text-radar-deal',
        )}
      >
        {value}
      </div>
      {hint && (
        <div
          className="mt-0.5 truncate text-radar-ink-400"
          title={typeof hint === 'string' ? hint : undefined}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
