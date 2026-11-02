import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, RotateCcw } from 'lucide-react';

import { cn } from '../lib/cn';
import { Button } from '../components/ui/button';
import { useDuty, type DutyCounter, type DutyTask } from '../../components/admin/DutyContext';
import { earliestFailure } from './duty-tower';
import { formatDuration, tickHeight } from '../lib/format';

/**
 * 值班条（概览首屏）。
 *
 * ## 三样东西
 *
 * 1. **刻度条**：最近 100 条任务的产出节拍，高度编码耗时，失败亮红。这是
 *    「机器刚才在不在转」的唯一时间维度读数，四个计数给不了。
 * 2. **四个计数**：等待 / 执行中 / 近 1 小时失败 / 冷却通道（财务模式换成
 *    待付 / 退款中 / 待开票 / 待对账），每个都能点进对应列表。
 * 3. **主动作**：有异常就「接手最早异常」直达那条任务，没有就给「查看最近
 *    产出」。按钮跟着数据走，不留一个点不动的按钮。
 *
 * 数据源是 `DutyContext`（30 秒轮询），不新增请求；轮询失败不清空快照，
 * 只在上方说明「这批没有刷新」。
 */

const FULL_TICKS = 100;

/**
 * 状态 → 刻度颜色。
 *
 * 刻度本体只在中性灰之间取三档，状态色只出现在失败与运行中 —— 一条带子里
 * 出现五种颜色就不再是指标。
 */
const TICK_COLOR: Record<DutyTask['status'], string> = {
  succeeded: 'bg-border',
  failed: 'bg-danger-text',
  running: 'bg-brand',
  queued: 'bg-warn-text',
  cancelled: 'bg-muted',
};

const MODE_LABEL: Record<string, string> = {
  tasks: '任务值班',
  finance: '财务值班',
};

export function DutyStrip() {
  const { data, loading, error, reload } = useDuty();

  const ticks = useMemo(() => (data ? data.tasks.slice(0, FULL_TICKS).reverse() : []), [data]);

  const action = useMemo(() => {
    if (!data) return null;
    if (data.mode === 'finance') {
      return { label: '处理待付订单', to: '/admin/orders?status=pending' };
    }
    const earliest = earliestFailure(data.tasks);
    return earliest
      ? { label: '接手最早异常', to: `/admin/tasks?id=${encodeURIComponent(earliest.id)}` }
      : { label: '查看最近产出', to: '/admin/tasks' };
  }, [data]);

  // 无任务读权也无订单读权：Provider 不注入，这里什么都不渲染
  if (!data && !loading && !error) return null;

  const failed = ticks.filter((t) => t.status === 'failed').length;
  const sub = data
    ? `${MODE_LABEL[data.mode] ?? '值班'} · ${
        data.mode === 'finance'
          ? '近 6 笔待办'
          : `最近 ${Math.min(data.tasks.length, FULL_TICKS)} 条任务`
      } · 截至 ${clock(data.fetchedAt)}`
    : '读取中…';

  return (
    <section
      aria-label="值班条"
      data-testid="admin-duty-strip"
      data-state={error ? 'error' : loading ? 'loading' : 'ready'}
      className="mb-4 overflow-hidden rounded-lg border border-border bg-card shadow-card"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h2 className="text-sm font-semibold text-card-foreground">值班</h2>
          <span className="truncate text-xs text-muted-foreground">{sub}</span>
        </div>
        {action && (
          <Button asChild size="sm">
            <Link to={action.to}>
              {action.label}
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          </Button>
        )}
      </header>

      {error && (
        <div
          className="flex items-center justify-between gap-2 border-b border-warn-border bg-warn-soft px-4 py-1.5 text-xs text-warn-text"
          role="status"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">读数没有刷新：{error}</span>
          </span>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 underline"
            onClick={reload}
          >
            <RotateCcw className="size-3" aria-hidden />
            重试
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:gap-6">
        {data?.mode !== 'finance' && (
          <div className="min-w-0 flex-1">
            <Ticks ticks={ticks} loading={loading && !data} failed={failed} />
            <Ruler ticks={ticks} />
          </div>
        )}

        <div
          className={cn(
            'grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4',
            data?.mode === 'finance' && 'lg:flex-1',
          )}
        >
          {(data?.counters ?? []).map((counter) => (
            <Counter key={counter.key} counter={counter} />
          ))}
          {!data && <div className="col-span-4 text-xs text-muted-foreground">读取中…</div>}
        </div>
      </div>
    </section>
  );
}

/** 刻度条：最近 100 条任务的产出节拍。 */
function Ticks({
  ticks,
  loading,
  failed,
}: {
  ticks: DutyTask[];
  loading: boolean;
  failed: number;
}) {
  if (loading) {
    return (
      <div className="flex h-8 items-end gap-px" aria-hidden>
        {Array.from({ length: FULL_TICKS }, (_, index) => (
          <span key={index} className="h-1.5 w-0.5 animate-pulse rounded-t-sm bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex h-8 items-end gap-px"
      role="img"
      aria-label={
        ticks.length === 0
          ? '最近没有任务'
          : `最近 ${ticks.length} 条任务的产出节拍，其中失败 ${failed} 条`
      }
    >
      {ticks.map((task) => (
        <span
          key={task.id}
          className={cn('w-0.5 shrink-0 rounded-t-sm', TICK_COLOR[task.status])}
          style={{ height: `${tickHeight(task.durationMs)}px` }}
          title={`${clock(task.createdAt)} · ${task.capabilityName} · ${formatDuration(
            task.durationMs,
          )}${task.errorCode ? ` · ${task.errorCode}` : ''}`}
        />
      ))}
    </div>
  );
}

/**
 * 时间尺：只标左、中、右三个时刻。
 *
 * 必须带日期 —— 快照横跨多天时只写 HH:MM 会出现「00:01 → 16:10 → 00:39」
 * 这种看着倒流的刻度，比不标更误导。
 */
function Ruler({ ticks }: { ticks: DutyTask[] }) {
  if (ticks.length < 2) return <div className="h-4" aria-hidden />;
  const first = ticks[0];
  const mid = ticks[Math.floor(ticks.length / 2)];
  const last = ticks[ticks.length - 1];
  return (
    <div
      className="mt-1 flex items-center justify-between text-[12px] text-muted-foreground"
      aria-hidden
    >
      <span>{stamp(first.createdAt)}</span>
      <span>{stamp(mid.createdAt)}</span>
      <span>{stamp(last.createdAt)}</span>
    </div>
  );
}

function Counter({ counter }: { counter: DutyCounter }) {
  const show = counter.value === null ? '—' : counter.value.toLocaleString('zh-CN');
  return (
    <Link
      to={counter.to}
      title={`${counter.label} · 打开对应列表`}
      className={cn(
        'flex flex-col justify-center rounded-lg border px-2.5 py-1.5 no-underline transition-colors',
        counter.tone === 'danger'
          ? 'border-danger-soft bg-danger-soft hover:border-danger-text/40'
          : counter.tone === 'warn'
            ? 'border-warn-border bg-warn-soft hover:border-warn-text/40'
            : 'border-border bg-muted/40 hover:border-ring/40',
      )}
    >
      <span className="truncate text-[12px] text-muted-foreground">{counter.label}</span>
      <span
        key={show}
        className={cn(
          'text-lg leading-6 font-semibold tabular-nums',
          counter.tone === 'danger'
            ? 'text-danger-text'
            : counter.tone === 'warn'
              ? 'text-warn-text'
              : 'text-foreground',
        )}
      >
        {show}
      </span>
    </Link>
  );
}

/** 时刻 → MM-DD HH:MM（跨天也不会读错顺序） */
function stamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${mm}-${dd} ${clock(iso)}`;
}

function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
}
