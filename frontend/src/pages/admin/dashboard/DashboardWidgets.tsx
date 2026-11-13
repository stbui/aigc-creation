import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { formatNumber, formatDateTime, Meter, formatDuration } from '../../../admin-ui/primitives';
import { taskErrorLabel } from '../../../lib/admin-error-codes';
import { adminOrderDetailHref, adminTaskHref } from '../../../lib/admin-links';
import type { DutyTask } from '../../../components/admin/DutyContext';
import type { AdminOrderRow, AdminOverview } from '../../../types/api';
import { QUEUE_LIMIT, hhmm, queueTime, yuan } from './utils';

/**
 * 概览页首屏构件与展示小节。
 *
 * 这里只放「怎么画」：队列、机器读数、财务读数与概览内的通用排版件。
 * 取数、权限判定与页面编排留在 `AdminDashboardContent`。
 */

/** 小节副标题：标题 + 口径说明 */
export function Subhead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-2.5 flex items-baseline gap-2 text-[13px] font-semibold text-foreground">
      <span>{title}</span>
      {note && <span className="text-[13px] font-normal text-muted-foreground">{note}</span>}
    </div>
  );
}

/** 行内空态：说明「为什么空」，不占整块空间 */
export function EmptyInline({ children }: { children: ReactNode }) {
  return <div className="py-6 text-[13px] leading-5 text-muted-foreground">{children}</div>;
}

/** 占比行：失败原因与渠道构成共用一套排版。 */
export function MeterRow({
  label,
  title,
  value,
  total,
  hint,
  tone = 'brand',
}: {
  label: string;
  title?: string;
  value: number;
  total: number;
  hint?: string;
  tone?: 'brand' | 'danger';
}) {
  return (
    <div className="grid grid-cols-[minmax(96px,160px)_minmax(120px,1fr)_auto] items-center gap-2.5 text-[13px]">
      <span className="truncate text-muted-foreground" title={title ?? label}>
        {label}
      </span>
      <Meter
        value={Math.max((value / Math.max(total, 1)) * 100, 2)}
        tone={tone === 'danger' ? 'danger' : 'brand'}
        className="h-2"
        decorative
      />
      <span className="text-right whitespace-nowrap text-muted-foreground tabular-nums">
        {hint ?? String(value)}
      </span>
    </div>
  );
}

/**
 * 异常队列。
 *
 * 最早的在最上面：值班条的主按钮「接手最早异常」跳到的那条，就是这里的
 * 第一行 —— 值班条与队列指向同一条任务，人不需要再找一次。
 */
export function FailureQueue({ tasks, loading }: { tasks: DutyTask[]; loading: boolean }) {
  const failures = tasks
    .filter((t) => t.status === 'failed')
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const shown = failures.slice(0, QUEUE_LIMIT);

  if (loading && tasks.length === 0) {
    return <EmptyInline>读取任务快照…</EmptyInline>;
  }
  if (shown.length === 0) {
    return (
      <EmptyInline>
        最近 {tasks.length} 条任务没有失败 —— 暂时没有需要接手的异常。
      </EmptyInline>
    );
  }

  return (
    <>
      <ol className="list-none">
        {shown.map((t, i) => (
          <li key={t.id}>
            <Link
              className="grid min-h-11 grid-cols-[22px_minmax(0,1fr)_auto_14px] items-center gap-2.5 rounded-md border-t border-border px-1.5 py-1 text-inherit no-underline transition-colors first:border-t-0 hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2"
              to={adminTaskHref(t.id)}
            >
              <span className="text-[12px] font-semibold text-muted-foreground">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="flex min-w-0 flex-col gap-px">
                <span className="overflow-hidden text-sm leading-[18px] font-semibold text-ellipsis whitespace-nowrap text-foreground">
                  {/* 状态点先于文字：一列红点让「这是异常」在扫视时成立 */}
                  <span
                    className="mr-1.5 inline-block size-[5px] rounded-full bg-danger-text align-[2px]"
                    aria-hidden
                  />
                  {t.capabilityName}
                </span>
                <span className="overflow-hidden text-[13px] leading-5 text-ellipsis whitespace-nowrap text-muted-foreground">
                  {/* 错误码放在原因前面：排障时先拿码去查日志 */}
                  {t.errorCode ? `${t.errorCode} · ` : ''}
                  {taskErrorLabel(t.errorCode)}
                  {` · ${formatDuration(t.durationMs)}`}
                </span>
              </span>
              <span
                className="text-[12px] text-muted-foreground"
                title={formatDateTime(t.createdAt)}
              >
                {queueTime(t.createdAt)}
              </span>
              <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden />
            </Link>
          </li>
        ))}
      </ol>
      {failures.length > shown.length && (
        <p className="mt-2.5 border-t border-border pt-2.5 text-[13px]">
          <Link className="text-brand hover:underline" to="/admin/tasks?status=failed">
            另有 {failures.length - shown.length} 条失败任务 →
          </Link>
        </p>
      )}
    </>
  );
}

/**
 * 最近一批已结算任务的成功率与中位耗时。
 *
 * 样本是最近 100 条任务里的已完成项，不是全量 —— 说明里写明，避免被
 * 读成「平台历史成功率」。
 */
export function MachineStats({ tasks }: { tasks: DutyTask[] }) {
  const finished = tasks.filter((t) => t.status === 'succeeded' || t.status === 'failed');
  const ok = finished.filter((t) => t.status === 'succeeded').length;
  const rate = finished.length > 0 ? Math.round((ok / finished.length) * 100) : null;
  const durations = finished
    .map((t) => t.durationMs)
    .filter((ms) => ms >= 0)
    .sort((a, b) => a - b);
  const median = durations.length > 0 ? durations[Math.floor(durations.length / 2)] : null;

  return (
    <dl className="grid grid-cols-3 gap-2.5 border-t border-border pt-3">
      <div className="min-w-0">
        {/* 「近期」是要紧的限定：下面还有一条近 N 天的成功率，不区分会被读成打架 */}
        <dt
          className="mb-0.5 overflow-hidden text-[13px] text-ellipsis whitespace-nowrap text-muted-foreground"
          title={`最近 ${tasks.length} 条任务中的已结算项`}
        >
          近期成功率
        </dt>
        <dd
          className={
            rate !== null && rate < 90
              ? 'text-base leading-5 font-semibold tracking-tight text-danger-text'
              : 'text-base leading-5 font-semibold tracking-tight text-foreground'
          }
        >
          {rate === null ? '—' : `${rate}%`}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="mb-0.5 overflow-hidden text-[13px] text-ellipsis whitespace-nowrap text-muted-foreground">
          中位耗时
        </dt>
        <dd className="text-base leading-5 font-semibold tracking-tight text-foreground">
          {median === null ? '—' : formatDuration(median)}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="mb-0.5 overflow-hidden text-[13px] text-ellipsis whitespace-nowrap text-muted-foreground">
          样本
        </dt>
        <dd className="text-base leading-5 font-semibold tracking-tight text-foreground">
          {finished.length}
        </dd>
      </div>
    </dl>
  );
}

/** 财务待办：最早的几笔待付订单，点开就是订单列表里的同一条 */
export function OrderQueue({ orders, loading }: { orders: AdminOrderRow[]; loading: boolean }) {
  if (loading) return <EmptyInline>读取订单…</EmptyInline>;
  if (orders.length === 0) return <EmptyInline>没有待支付订单。</EmptyInline>;

  return (
    <ol className="list-none">
      {orders.map((o, i) => (
        <li key={o.id}>
          <Link
            className="grid min-h-11 grid-cols-[22px_minmax(0,1fr)_auto_auto_14px] items-center gap-2.5 rounded-md border-t border-border px-1.5 py-1 text-inherit no-underline transition-colors first:border-t-0 hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2"
            to={adminOrderDetailHref(o.id)}
          >
            <span className="text-[12px] font-semibold text-muted-foreground">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="flex min-w-0 flex-col gap-px">
              <span className="overflow-hidden text-sm leading-[18px] font-semibold text-ellipsis whitespace-nowrap text-foreground">
                {o.orderNo}
              </span>
              <span className="overflow-hidden text-[13px] leading-5 text-ellipsis whitespace-nowrap text-muted-foreground">
                {o.userEmail}
              </span>
            </span>
            <span className="text-[13px] font-semibold text-foreground">
              ¥{yuan(o.totalCents, 0)}
            </span>
            <span
              className="text-[12px] text-muted-foreground"
              title={formatDateTime(o.createdAt)}
            >
              {hhmm(o.createdAt)}
            </span>
            <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden />
          </Link>
        </li>
      ))}
    </ol>
  );
}

/** 财务视角的机器状态：交易口径的关键读数，不做任务成功率 */
export function FinanceGrid({
  commerce,
  days,
}: {
  commerce: AdminOverview['commerce'];
  days: number;
}) {
  const items: Array<{ label: string; value: string; tone?: 'danger' | 'warn' }> = [
    /*
     * 口径写进标签：这里是**订单实付**（元，Σ `Order.paidCents`），
     * 与财务分析页的「净收入（积分）」（已结算账单金额）不是同一笔账。
     * 两个都叫「营收」会让人把两处数字对在一起，对不上就以为其中一处坏了。
     */
    { label: `近 ${days} 天营收（元）`, value: `¥${yuan(commerce.gmvWindowCents)}` },
    {
      label: '支付成功率',
      value: commerce.paymentSuccessRate === null ? '—' : `${commerce.paymentSuccessRate}%`,
    },
    { label: '待付金额', value: `¥${yuan(commerce.pendingCents, 0)}` },
    {
      label: `近 ${days} 天退款`,
      value: `¥${yuan(commerce.refundedWindowCents)}`,
      tone: commerce.refundedWindowCents > 0 ? 'danger' : undefined,
    },
    { label: '有效会员', value: formatNumber(commerce.members.active) },
    {
      label: `近 ${days} 天积分消耗`,
      value: formatNumber(commerce.credits.consumedInWindow),
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="mb-0.5 overflow-hidden text-[13px] text-ellipsis whitespace-nowrap text-muted-foreground">
            {item.label}
          </dt>
          <dd
            className={
              item.tone === 'danger'
                ? 'text-base leading-5 font-semibold tracking-tight text-danger-text'
                : item.tone === 'warn'
                  ? 'text-base leading-5 font-semibold tracking-tight text-warn-text'
                  : 'text-base leading-5 font-semibold tracking-tight text-foreground'
            }
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
