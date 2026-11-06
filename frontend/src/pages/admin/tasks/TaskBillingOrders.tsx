import { AlertTriangle, ExternalLink, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Notice,
  StaleError,
  StatusTag,
  type TagTone,
} from '~/admin-ui/primitives';
import {
  REFUND_REASON_LABELS,
  STATUS_LABELS,
  STATUS_TONES,
} from '../billing-orders/constants';
import type { BillingOrderListResult, BillingOrderView } from '../../../types/model';
import { adminBillingOrdersApi } from './api';
import { useAdminResource } from './hooks';
import {
  adminBillingOrdersHref,
  formatDateTime,
  toCredits,
} from './utils';

type ReviewMeta = {
  label: string;
  tone: TagTone;
  note: string;
};

/**
 * 账单终态优先于 RouteAttempt.dispatchState。
 *
 * 历史存量里有建连前网络失败仍落成 `submission_unknown` 的记录；对账完成后
 * 账单已经是 refunded + system:preconnection-reconcile。此时页面必须回答
 * 「系统已自动退款，不需要人工复核」，不能再按旧派发状态吓运营。
 */
function reviewMeta(order: BillingOrderView): ReviewMeta {
  if (order.refundReason === 'route_switch') {
    return {
      label: '换线重预留',
      tone: 'brand',
      note: '旧账单预授权已内部转到新线路，不计入真实退款。',
    };
  }
  if (order.reviewable) {
    return {
      label: '待人工核对',
      tone: 'danger',
      note: '上游可能已经接单；为避免重复扣费，不能自动重发，需人工确认后结算或退款。',
    };
  }
  if (order.status === 'refunded') {
    if (order.resolvedBy.startsWith('system:')) {
      const preconnection = order.resolvedBy === 'system:preconnection-reconcile';
      return {
        label: preconnection ? '系统对账退款' : '系统自动退款',
        tone: 'success',
        note: preconnection
          ? '建连前网络失败，请求没有到达上游；积分已自动退回，无需人工复核。'
          : '系统已完成自动退款，无需人工复核。',
      };
    }
    return {
      label: '已退款',
      tone: 'warn',
      note: '账单已由人工或既有流程处置完成。',
    };
  }
  if (order.status === 'settled') {
    return {
      label: '已结算',
      tone: 'success',
      note: '账单已按实际用量完成结算。',
    };
  }
  if (order.status === 'uncertain') {
    return {
      label: '结果不明',
      tone: 'warn',
      note: '当前不满足人工核对条件，请结合线路尝试和模型调用继续排查。',
    };
  }
  return {
    label: STATUS_LABELS[order.status] ?? order.status,
    tone: STATUS_TONES[order.status] ?? 'muted',
    note: order.status === 'reserved' ? '积分已预留，等待任务执行结果。' : '账单仍在处理中。',
  };
}

function resolverLabel(resolvedBy: string): string {
  if (!resolvedBy) return '—';
  if (resolvedBy === 'system:preconnection-reconcile') return '系统对账任务';
  if (resolvedBy.startsWith('system:')) return `系统自动处理（${resolvedBy.slice(7)}）`;
  return `人工处理（${resolvedBy}）`;
}

function BillingOrderItem({ order, index }: { order: BillingOrderView; index: number }) {
  const review = reviewMeta(order);
  const isSystemResolved = order.resolvedBy.startsWith('system:');

  return (
    <article className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-medium text-muted-foreground tabular-nums">
            账单 {index + 1}
          </span>
          <StatusTag
            status={order.status}
            label={STATUS_LABELS[order.status] ?? order.status}
            tone={STATUS_TONES[order.status] ?? 'muted'}
          />
          <StatusTag status={`review-${review.label}`} label={review.label} tone={review.tone} />
          {order.refundReason === 'route_switch' && (
            <span className="text-[12px] text-muted-foreground">线路切换</span>
          )}
        </div>
        <time className="text-[12px] text-muted-foreground tabular-nums" dateTime={order.createdAt}>
          {formatDateTime(order.createdAt)}
        </time>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-x-5 gap-y-1.5 text-[12px] sm:grid-cols-2">
        <div className="min-w-0">
          <span className="text-muted-foreground">渠道 / 模型：</span>
          <span className="break-words text-foreground">
            {order.channelName || order.channelId || '—'} ·{' '}
            {order.channelModelName || order.channelModelId || '—'}
          </span>
        </div>
        <div className="min-w-0">
          <span className="text-muted-foreground">金额：</span>
          <span className="tabular-nums text-foreground">
            预留 {toCredits(order.reservedAmountMicrocredits)} · 实结{' '}
            {toCredits(order.actualAmountMicrocredits)}
            {order.refundedAmountMicrocredits > 0
              ? ` · 退 ${toCredits(order.refundedAmountMicrocredits)}`
              : ''}
          </span>
        </div>
        <div className="min-w-0">
          <span className="text-muted-foreground">上游请求号：</span>
          <code className="break-all font-mono text-[12px] text-foreground">
            {order.providerRequestId || '—'}
          </code>
        </div>
        <div className="min-w-0">
          <span className="text-muted-foreground">处理人：</span>
          <span className="break-words text-foreground">{resolverLabel(order.resolvedBy)}</span>
        </div>
        <div className="min-w-0">
          <span className="text-muted-foreground">账单时间：</span>
          <span className="text-foreground tabular-nums">
            {formatDateTime(order.startedAt)} → {formatDateTime(order.settledAt ?? order.refundedAt)}
          </span>
        </div>
        {order.refundReason && (
          <div className="min-w-0">
            <span className="text-muted-foreground">退款归类：</span>
            <span className="break-words text-foreground">
              {REFUND_REASON_LABELS[order.refundReason] ?? order.refundReason}
            </span>
          </div>
        )}
      </div>

      <div
        className={
          isSystemResolved || order.status === 'settled'
            ? 'mt-2 flex items-start gap-1.5 rounded-md bg-success-soft px-2.5 py-2 text-[12px] leading-5 text-success-text'
            : order.reviewable
              ? 'mt-2 flex items-start gap-1.5 rounded-md bg-danger-soft px-2.5 py-2 text-[12px] leading-5 text-danger-text'
              : 'mt-2 flex items-start gap-1.5 rounded-md bg-warn-soft px-2.5 py-2 text-[12px] leading-5 text-warn-text'
        }
      >
        {isSystemResolved || order.status === 'settled' ? (
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        ) : (
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        )}
        <span>{review.note}</span>
      </div>

      {order.resolutionNote && (
        <p className="mt-1.5 line-clamp-3 break-words text-[12px] leading-5 text-muted-foreground">
          {order.resolutionNote}
        </p>
      )}
      {order.errorText && (
        <p
          className="mt-1.5 line-clamp-3 break-words text-[12px] leading-5 text-muted-foreground"
          title={order.errorText}
        >
          失败原因：{order.errorText}
        </p>
      )}
    </article>
  );
}

function TaskBillingOrdersContent({ taskId }: { taskId: string }) {
  const { data, loading, error, reload } = useAdminResource<BillingOrderListResult>(
    () => adminBillingOrdersApi.list({ taskId, page: 1, pageSize: 100 }),
    [taskId],
  );
  const orders = data?.items ?? [];
  const pendingReview = orders.filter((order) => order.reviewable).length;
  const allTerminal =
    orders.length > 0 &&
    orders.every((order) => order.status === 'settled' || order.status === 'refunded');
  const summary = pendingReview
    ? `待人工核对 ${pendingReview} 笔`
    : allTerminal
      ? '无需人工核对'
      : orders.length
        ? '处理中'
        : '暂无账单';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <h4 className="text-[13px] font-semibold text-foreground">积分预留 / 结算</h4>
          {orders.length > 0 && (
            <StatusTag
              status={`review-summary-${summary}`}
              label={summary}
              tone={pendingReview ? 'danger' : allTerminal ? 'success' : 'muted'}
            />
          )}
        </div>
        <Link
          className="inline-flex items-center gap-1 text-[12px] text-brand hover:underline"
          to={adminBillingOrdersHref({ taskId })}
        >
          查看账单列表
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      </div>

      {error && data && <StaleError error={error} onRetry={() => void reload()} />}
      {error && !data && (
        <Notice tone="warn" title="账单加载失败" className="mb-0">
          {error}
        </Notice>
      )}
      {loading && !data && (
        <div className="flex flex-col gap-2" aria-label="正在加载账单">
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
        </div>
      )}
      {!loading && !error && orders.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-3 text-[12px] leading-5 text-muted-foreground">
          该任务尚未产生账单。免费任务、批次子任务或尚未进入预留阶段时会显示为空。
        </div>
      )}
      {orders.map((order, index) => (
        <BillingOrderItem key={order.id} order={order} index={index} />
      ))}
    </div>
  );
}

/**
 * 任务详情内的账单摘要。
 *
 * 账单属于财务数据，必须单独持有 `billing_order.read`。无权限时不挂载
 * 请求组件，避免 UI 隐藏但后台仍收到越权请求。
 */
export function TaskBillingOrders({ taskId, canRead }: { taskId: string; canRead: boolean }) {
  if (!canRead) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-[12px] leading-5 text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>当前角色没有账单查看权限，积分预留、退款和人工核对结果暂不可见。</span>
      </div>
    );
  }
  return <TaskBillingOrdersContent key={taskId} taskId={taskId} />;
}
