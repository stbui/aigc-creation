import { ExternalLink, GitBranch, ImageOff, Image as ImageIcon, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DetailSection, StatusTag, type TagTone } from '~/admin-ui/primitives';
import type { AdminTaskDetail } from '../../../types/api';
import type { AdminTaskRouteAttempt } from '../../../types/task-route';
import { TaskBillingOrders } from './TaskBillingOrders';
import { TaskModelCalls } from './TaskModelCalls';
import {
  adminModelCallsHref,
  cn,
  formatDateTime,
  formatDuration,
} from './utils';

const PRE_CONNECTION_FAILURES = new Set([
  'outbound_invalid_url',
  'outbound_blocked_host',
  'outbound_dns_failed',
  'outbound_proxy_invalid',
  'outbound_connection_refused',
  'outbound_network_unreachable',
  // 历史数据里曾把建连前网络失败统一记成这个码。
  'outbound_network',
]);

type AttemptMeta = {
  label: string;
  tone: TagTone;
  note: string;
};

/**
 * 线路记录的展示语义。
 *
 * `dispatchState` 是运行时安全切的唯一依据；这里只把它翻译成运营能读懂
 * 的结论。建连前失败额外优先识别，因为存量记录可能仍是
 * `submission_unknown`，但事实是请求从未到达上游。
 */
function attemptMeta(attempt: AdminTaskRouteAttempt): AttemptMeta {
  if (PRE_CONNECTION_FAILURES.has(attempt.failureCode)) {
    return {
      label: '建连前网络失败',
      tone: 'warn',
      note: '请求没有到达上游，可安全切线；无后续线路时由系统自动退款，无需人工复核。',
    };
  }
  if (attempt.status === 'succeeded') {
    return {
      label: '上游已产出',
      tone: 'success',
      note: '该线路已完成生成并返回结果。',
    };
  }
  if (attempt.status === 'dispatching' && attempt.dispatchState === 'accepted') {
    return {
      label: '上游已接单',
      tone: 'brand',
      note: '上游已受理请求，正在等待或轮询结果。',
    };
  }
  if (attempt.status === 'failed' && attempt.dispatchState === 'rejected_no_job') {
    return {
      label: '上游未接单',
      tone: 'warn',
      note: '已确认上游没有接下任务，可以安全切换线路。',
    };
  }
  if (
    attempt.dispatchState === 'submission_unknown' ||
    (attempt.status === 'failed' && attempt.dispatchState === 'not_sent')
  ) {
    return {
      label: '结果待确认',
      tone: 'danger',
      note: '可能已经发出请求；为避免重复扣费，不能自动重发，需要结合账单判断是否人工核对。',
    };
  }
  if (attempt.status === 'selected' || attempt.dispatchState === 'not_sent') {
    return {
      label: '已选择，未派发',
      tone: 'muted',
      note: '已选定线路，但请求尚未发出。',
    };
  }
  return {
    label: attempt.status || '状态未知',
    tone: 'muted',
    note: '该线路记录尚未进入已知终态。',
  };
}

function durationOf(attempt: AdminTaskRouteAttempt): number | null {
  if (!attempt.completedAt) return null;
  const started = Date.parse(attempt.startedAt);
  const completed = Date.parse(attempt.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return null;
  return Math.max(0, completed - started);
}

function AttemptItem({ attempt }: { attempt: AdminTaskRouteAttempt }) {
  const meta = attemptMeta(attempt);
  const duration = durationOf(attempt);

  return (
    <li className="relative flex gap-3">
      <span
        className={cn(
          'relative z-10 mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border',
          meta.tone === 'success'
            ? 'border-success-text bg-success-soft text-success-text'
            : meta.tone === 'danger'
              ? 'border-danger-text bg-danger-soft text-danger-text'
              : meta.tone === 'warn'
                ? 'border-warn-border bg-warn-soft text-warn-text'
                : 'border-border bg-muted text-muted-foreground',
        )}
        aria-hidden
      >
        <GitBranch className="size-3" />
      </span>
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-[12px] font-medium text-foreground tabular-nums">
              第 {attempt.routeRun} 轮 · 第 {attempt.attemptNumber} 次
            </span>
            <StatusTag
              status={`attempt-${attempt.status}-${attempt.dispatchState}`}
              label={meta.label}
              tone={meta.tone}
            />
          </div>
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {duration === null ? '耗时未知' : formatDuration(duration)}
          </span>
        </div>

        <div className="mt-2 grid grid-cols-1 gap-x-5 gap-y-1.5 text-[12px] sm:grid-cols-2">
          <div className="min-w-0">
            <span className="text-muted-foreground">渠道：</span>
            <code className="break-all font-mono text-foreground">{attempt.channelId || '—'}</code>
          </div>
          <div className="min-w-0">
            <span className="text-muted-foreground">渠道模型：</span>
            <code className="break-all font-mono text-foreground">
              {attempt.channelModelId || '—'}
            </code>
          </div>
          <div className="min-w-0">
            <span className="text-muted-foreground">开始：</span>
            <span className="text-foreground tabular-nums">{formatDateTime(attempt.startedAt)}</span>
          </div>
          <div className="min-w-0">
            <span className="text-muted-foreground">完成：</span>
            <span className="text-foreground tabular-nums">
              {formatDateTime(attempt.completedAt)}
            </span>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <span className="text-muted-foreground">上游请求号：</span>
            <code className="break-all font-mono text-foreground">
              {attempt.providerRequestId || '—'}
            </code>
          </div>
        </div>

        <p
          className={cn(
            'mt-2 rounded-md px-2.5 py-2 text-[12px] leading-5',
            meta.tone === 'danger'
              ? 'bg-danger-soft text-danger-text'
              : meta.tone === 'success'
                ? 'bg-success-soft text-success-text'
                : 'bg-warn-soft text-warn-text',
          )}
        >
          {meta.note}
        </p>

        {(attempt.failureCode || attempt.failureMessage) && (
          <div className="mt-2 min-w-0 text-[12px] leading-5">
            {attempt.failureCode && (
              <div className="font-mono text-danger-text">{attempt.failureCode}</div>
            )}
            {attempt.failureMessage && (
              <p
                className="line-clamp-3 break-words text-muted-foreground"
                title={attempt.failureMessage}
              >
                {attempt.failureMessage}
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function RouteAttempts({ task, attempts }: { task: AdminTaskDetail; attempts: AdminTaskRouteAttempt[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <h4 className="text-[13px] font-semibold text-foreground">线路尝试</h4>
          <span className="text-[12px] text-muted-foreground">
            {attempts.length > 0 ? `共 ${attempts.length} 次` : '尚无记录'}
          </span>
        </div>
        <Link
          className="inline-flex items-center gap-1 text-[12px] text-brand hover:underline"
          to={adminModelCallsHref({ taskId: task.id })}
        >
          查看全部模型调用
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      </div>

      {attempts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-3 text-[12px] leading-5 text-muted-foreground">
          该任务尚未记录线路派发。排队任务或历史任务可能没有 RouteAttempt 快照。
        </div>
      ) : (
        <ol className="flex flex-col gap-2">
          {attempts.map((attempt) => (
            <AttemptItem key={attempt.id} attempt={attempt} />
          ))}
        </ol>
      )}
    </div>
  );
}

function ChainSummary({
  task,
  attempts,
  canReadBilling,
  canReadModelCalls,
}: {
  task: AdminTaskDetail;
  attempts: AdminTaskRouteAttempt[];
  canReadBilling: boolean;
  canReadModelCalls: boolean;
}) {
  const lastAttempt = attempts[attempts.length - 1];
  const outputState = task.outputAsset
    ? '产出已落盘'
    : task.status === 'succeeded'
      ? '已完成但无产出'
      : '尚未产出';
  const items = [
    { label: '用户提交', value: formatDateTime(task.createdAt) },
    {
      label: '积分 / 结算',
      value: canReadBilling ? '见下方账单' : '无查看权限',
    },
    {
      label: '线路派发',
      value: lastAttempt
        ? `${attempts.length} 次 · 最近 ${attemptMeta(lastAttempt).label}`
        : '尚无记录',
    },
    {
      label: '模型调用',
      value: canReadModelCalls ? '见下方明细' : '无查看权限',
    },
    { label: '产出', value: outputState },
  ];

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 rounded-lg border border-border bg-muted/30 px-2.5 py-2">
          <div className="text-[11px] text-muted-foreground">{item.label}</div>
          <div className="mt-0.5 break-words text-[12px] font-medium text-foreground">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 任务详情里的全链路排障区。
 *
 * 一个任务从提交到终态的实体分散在 GenerationTask / RouteAttempt /
 * BillingOrder / ApiCallLog；这里按 taskId 把它们放入同一抽屉。账单和
 * 模型调用仍使用各自权限与接口，避免 task.read 隐式扩大成财务读取权限。
 */
export function TaskFullChain({
  task,
  canReadBilling,
  canReadModelCalls,
}: {
  task: AdminTaskDetail;
  canReadBilling: boolean;
  canReadModelCalls: boolean;
}) {
  /*
   * 兼容前后端发布不同步：旧版任务详情没有 routeAttempts 字段。
   * 缺失时按“暂无线路快照”展示，不能因一次灰度发布让整个抽屉崩溃。
   */
  const attempts = task.routeAttempts ?? [];
  return (
    <DetailSection
      title="全链路"
      note="用户提交 → 积分预留 → 线路派发 → 模型调用 → 产出 → 结算 / 退款 / 人工核对"
    >
      <div className="flex flex-col gap-4">
        <ChainSummary
          task={task}
          attempts={attempts}
          canReadBilling={canReadBilling}
          canReadModelCalls={canReadModelCalls}
        />

        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-[12px] leading-5 text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success-text" aria-hidden />
          <span>
            链路事实均关联同一任务 ID。线路失败先看派发状态，资金是否已处理以账单终态为准；
            系统对账退款不会进入人工核对队列。
          </span>
        </div>

        <RouteAttempts task={task} attempts={attempts} />
        <TaskBillingOrders taskId={task.id} canRead={canReadBilling} />
        <TaskModelCalls taskId={task.id} canRead={canReadModelCalls} />

        <div className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-2 text-[12px] leading-5 text-muted-foreground">
          {task.outputAsset ? (
            <ImageIcon className="mt-0.5 size-3.5 shrink-0 text-success-text" aria-hidden />
          ) : (
            <ImageOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          )}
          <span>
            产出：{outputStateFor(task)}
          </span>
        </div>
      </div>
    </DetailSection>
  );
}

function outputStateFor(task: AdminTaskDetail): string {
  if (task.outputAsset) {
    return `已落盘，素材 ID ${task.outputAsset.id}，可在下方预览或前往素材库。`;
  }
  if (task.status === 'succeeded') return '任务标记为成功，但未关联产出素材，需要检查落盘链路。';
  if (task.status === 'failed') return '任务失败，未产出素材。';
  if (task.status === 'cancelled') return '任务已终止，未产出素材。';
  return '尚未产出，任务可能仍在排队或执行中。';
}
