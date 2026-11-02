import { useEffect, useState } from 'react';
import { useAdmin, useToast, useAdminResource } from './hooks';
import { AlertTriangle, CheckCircle2, Clock, Play, RefreshCw, XCircle } from 'lucide-react';

import { adminSchedulerApi } from '../../../lib/api';


import { ActionButton, EmptyState, ListError, Notice, PageHeader, PageSkeleton, Panel, StaleError, ToneBadge } from './components';
import { cn } from '../../../admin-ui/lib/cn';
import type { AdminSchedulerTask } from '../../../types/api';

/** 相对时间 —— 运维看的是「多久没跑了」，不是绝对时间 */
function since(iso: string | null): string {
  if (!iso) return '从未执行';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

/** 上次没跑成功 → 用醒目色；从未跑过 → 灰色 */
function freshness(t: AdminSchedulerTask): 'ok' | 'failed' | 'never' {
  if (t.consecutiveFailures > 0) return 'failed';
  if (!t.lastRunAt) return 'never';
  return 'ok';
}

/**
 * 三态的视觉表达：边框色 + 图标。
 *
 * 只有「失败」染红 —— 从未执行只是「还没到点」，多数是部署后首轮未触发，
 * 一律标红会让真正失败的条目失去分量。
 */
const FRESHNESS_STYLE: Record<
  'ok' | 'failed' | 'never',
  { row: string; icon: string; Icon: typeof CheckCircle2 }
> = {
  ok: { row: 'border-border bg-card', icon: 'text-success-text', Icon: CheckCircle2 },
  failed: { row: 'border-danger-soft bg-danger-soft/40', icon: 'text-danger-text', Icon: XCircle },
  never: { row: 'border-border bg-card', icon: 'text-muted-foreground', Icon: Clock },
};

/**
 * 定时任务 (admin-prd.md §3.18 B-90 / M9.5)。
 *
 * 这个页面的核心价值：**让「静默失败」变得可见**。
 * 一个没人看得出已经挂了三个月的定时任务，比没有调度更危险 ——
 * 所有人都会以为它在跑。
 */
export function AdminSchedulerPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const writable = can('setting.write');

  const [busy, setBusy] = useState(false);

  /*
   * 手动刷新的反馈与竞态保护都由 `useAdminResource` 提供 ——
   * 手写 load 容易漏掉「开始时置 loading」，失败后点重试就没反应。
   */
  const { data, loading, error, reload } = useAdminResource(() => adminSchedulerApi.status());

  useEffect(() => {
    /*
     * 每 30 秒轮询：调度器是分钟级节奏，太频繁没意义，太稀疏会漏看故障。
     * 轮询走 silent —— 否则「刷新」按钮每 30 秒自己闪一次转圈，
     * 时间久了没人再把它当操作反馈。
     */
    const timer = setInterval(() => void reload({ silent: true }), 30_000);
    return () => clearInterval(timer);
  }, [reload]);

  /** 手动触发是幂等的，按产品要求直接执行，不再弹窗二次确认 */
  const runNow = async (target: AdminSchedulerTask) => {
    setBusy(true);
    try {
      await adminSchedulerApi.run(target.name);
      toast.success(`「${target.label}」已手动执行`);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /*
   * 页头照常渲染：加载期间标题与说明就该在位。
   * 之前的守卫整页替换，首屏先闪一段没有标题的灰条，再冒出完整页面 ——
   * 骨架该占住位置，不是把版面清空。
   */
  if (loading && !data) {
    return (
      <PageSkeleton
        title="定时任务"
        description="订单超时关闭、积分到期回收、备份与保留期清理的统一调度"
        actions={
          <ActionButton variant="secondary" icon={RefreshCw} disabled>
            刷新
          </ActionButton>
        }
        panels={2}
        panelRows={5}
      />
    );
  }
  if (error && !data) return <ListError error={error} onRetry={() => void reload()} />;
  if (!data) return <EmptyState title="暂无调度信息" />;

  const failing = data.failing;
  const failingLabels = data.tasks
    .filter((task) => failing.includes(task.name))
    .map((task) => `${task.label}（${task.consecutiveFailures} 次）`)
    .join('、');

  return (
    <>
      <PageHeader
        title="定时任务"
        description="订单超时关闭、积分到期回收、备份与保留期清理的统一调度"
        actions={
          <ActionButton
            variant="secondary"
            icon={RefreshCw}
            disabled={loading}
            onClick={() => void reload()}
          >
            刷新
          </ActionButton>
        }
      />

      {/*
       * 刷新失败但手上有旧数据：保留内容，但必须明说「这是上次的」——
       * 静默展示过期状态正是本页最需要防的事。
       */}
      {error && <StaleError error={error} onRetry={() => void reload()} />}

      {/* 连续失败置顶告警：这正是「没人看出调度已挂」的解药 */}
      {failing.length > 0 && (
        <Notice
          tone="danger"
          title={`${failing.length} 个任务连续失败`}
          icon={<AlertTriangle className="size-4 shrink-0" aria-hidden />}
        >
          <p>涉及：{failingLabels}</p>
          <p>调度器不会因为单个任务失败而停止其它任务，但该任务已停止生效。</p>
        </Notice>
      )}

      <Panel title="任务列表" note="每 10 分钟检查一次；单个任务失败不影响其它任务">
        <div className="flex flex-col gap-2">
          {data.tasks.map((task) => {
            const style = FRESHNESS_STYLE[freshness(task)];
            const Icon = style.Icon;
            return (
              <div
                key={task.name}
                data-testid="admin-task-row"
                data-task={task.name}
                className={cn('flex items-center gap-3 rounded-lg border px-3.5 py-2.5', style.row)}
              >
                <span className={cn('shrink-0', style.icon)}>
                  <Icon className="size-[18px]" aria-hidden />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-foreground">{task.label}</span>
                    <code className="font-mono text-[12px] text-muted-foreground">
                      {task.name}
                    </code>
                  </div>
                  <div className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
                    上次执行：{since(task.lastRunAt)}
                    {task.lastDurationMs !== null && ` · 耗时 ${task.lastDurationMs}ms`}
                    {task.totalRuns > 0 && ` · 累计 ${task.totalRuns} 次`}
                  </div>
                  {task.lastError && (
                    <div
                      className="mt-1 truncate font-mono text-[12px] text-danger-text"
                      title={task.lastError}
                    >
                      {task.lastError}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {task.consecutiveFailures > 0 && (
                    <ToneBadge tone="danger">连续失败 {task.consecutiveFailures}</ToneBadge>
                  )}
                  {/*
                   * 有些任务按设计不可手动触发（备份 / 清理会写库）。什么都不显示
                   * 会让人以为「按钮丢了」，补一句「定时执行」把空位说明白。
                   */}
                  {!data.manuallyRunnable.includes(task.name) ? (
                    <span className="text-[12px] text-muted-foreground">定时执行</span>
                  ) : writable ? (
                    <ActionButton
                      variant="secondary"
                      icon={Play}
                      disabled={busy}
                      onClick={() => void runNow(task)}
                    >
                      立即执行
                    </ActionButton>
                  ) : (
                    <span className="text-[12px] text-muted-foreground">仅查看</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="设计说明" note="为什么这些能手动触发、哪些不能">
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-xs leading-5 text-muted-foreground">
          <li>
            <strong className="text-foreground">可手动触发</strong>：订单超时关闭、积分到期回收。
            两者都是「扫一批已到期的」，重复执行不产生副作用 —— 这是幂等的前提。
          </li>
          <li>
            <strong className="text-foreground">不可手动触发</strong>：备份、保留期清理。
            它们会写文件或删数据，被随意触发可能覆盖可用备份或误删未到期数据。
          </li>
          <li>
            <strong className="text-foreground">失败隔离</strong>：每个任务独立捕获异常。
            早期版本用一个大 try 包住全部任务，结果备份一抛错，订单超时关闭就被跳过 ——
            订单不关闭会直接影响用户看到的可用金额。
          </li>
          <li>
            <strong className="text-foreground">节流</strong>：订单关闭最短间隔 5 分钟、积分回收
            10 分钟。订单超时是 30 分钟粒度，再密也没意义，而回收涉及多次写库。
          </li>
        </ul>
      </Panel>
    </>
  );
}
