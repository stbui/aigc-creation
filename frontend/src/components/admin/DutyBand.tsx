import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { isCooling, useDuty, type DutyChannel, type DutyCounter, type DutyTask } from './DutyContext';

/**
 * 值班带（后台视觉方向「值班台」）。
 *
 * ## 它是什么
 *
 * 一条常驻在后台内容区顶部的深色仪表带：100 根 2px 刻度是最近 100 条
 * 生成任务的产出节拍（高度编码耗时，失败在顶部亮 2px 红帽），右侧四个
 * 计数回答「现在有什么在排队、什么坏了、哪条线路在冷却」。
 *
 * ## 为什么不做成卡片
 *
 * 18 个同权重的数字让「异常」淹没在「正常」里。带子只保留四个会变化、
 * 需要动作的计数，其余指标留在各自的列表页 —— 数字要能回答问题，
 * 不能只是显得信息丰富。
 *
 * ## 尺寸
 *
 * 概览页 128px（标题 56 + 刻度 52 + 时间尺 20），其余页面压缩到 44px
 * 并吸顶。两档共用同一份数据与同一套刻度，不做两套实现。
 */

const MODALITY_LABEL: Record<string, string> = {
  image: '文生图',
  text: '文生文',
  video: '文生视频',
};

/** 刻度根数：概览给满 100 条，压缩态只留 60 根，避免 44px 里挤成噪点 */
const FULL_TICKS = 100;
const COMPACT_TICKS = 60;

interface Props {
  variant: 'full' | 'compact';
}

export function AdminDutyBand({ variant }: Props) {
  const { data, loading, error, reload } = useDuty();
  const isFull = variant === 'full';

  const ticks = useMemo(() => {
    if (!data) return [];
    const take = data.tasks.slice(0, isFull ? FULL_TICKS : COMPACT_TICKS);
    return take.slice().reverse();
  }, [data, isFull]);

  const counters = data?.counters ?? [];

  /*
   * 主动作跟着数据走：有最早一条异常就去接手它；队列空了就换成「查看最近
   * 产出」，而不是留一个点不动的按钮。财务模式没有「异常」这个概念，
   * 主动作落在最早一笔待办上。
   */
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

  const sub = data
    ? `${data.mode === 'finance' ? '财务待办' : `近 ${Math.min(data.tasks.length, 100)} 条任务`} · 截至 ${clock(data.fetchedAt)}`
    : loading
      ? '读取中…'
      : '暂无数据';

  return (
    <section
      className={`adm-band${isFull ? ' is-full' : ' is-compact'}`}
      aria-label="值班带"
      data-state={error ? 'error' : loading ? 'loading' : 'ready'}
    >
      {!isFull && (
        <>
          <span className="adm-band-name">值班带</span>
          <Ticks ticks={ticks} loading={loading && !data} dense />
          <div className="adm-band-counters">
            {counters.map((c) => (
              <Counter key={c.key} counter={c} compact />
            ))}
          </div>
          {error && <BandFailure error={error} onRetry={reload} compact />}
        </>
      )}

      {isFull && (
        <>
          <div className="adm-band-top">
            <div className="adm-band-title">
              <span className="adm-band-name">值班带</span>
              <span className="adm-band-sub">{sub}</span>
            </div>
            {action && (
              <Link className="adm-band-action" to={action.to}>
                {action.label}
              </Link>
            )}
          </div>

          <div className="adm-band-body">
            <div className="adm-band-meter">
              <Ticks ticks={ticks} loading={loading && !data} />
              <Ruler ticks={ticks} />
            </div>
            <div className="adm-band-counters">
              {counters.map((c) => (
                <Counter key={c.key} counter={c} />
              ))}
            </div>
          </div>

          {error && <BandFailure error={error} onRetry={reload} />}
        </>
      )}
    </section>
  );
}

/**
 * 刻度条。
 *
 * 高度按耗时取对数（200ms → 最矮，60s 以上 → 最高），这样 1 秒与 3 秒
 * 能看出差别，30 秒与 60 秒也不会差到失真。状态只出现在顶部 2px 帽上，
 * 刻度本体始终保持同一族中性色 —— 一条带子里出现五种颜色就不再是指标。
 */
function Ticks({ ticks, loading, dense }: { ticks: DutyTask[]; loading?: boolean; dense?: boolean }) {
  if (loading) {
    return (
      <div className={`adm-ticks${dense ? ' is-dense' : ''}`} aria-hidden="true">
        {Array.from({ length: dense ? COMPACT_TICKS : FULL_TICKS }, (_, i) => (
          <span key={i} className="adm-tick is-placeholder" style={{ height: 6 }} />
        ))}
      </div>
    );
  }

  const failed = ticks.filter((t) => t.status === 'failed').length;

  return (
    <div
      className={`adm-ticks${dense ? ' is-dense' : ''}`}
      role="img"
      aria-label={
        ticks.length === 0
          ? '最近没有任务'
          : `最近 ${ticks.length} 条任务的产出节拍，其中失败 ${failed} 条`
      }
    >
      {ticks.map((t) => (
        <span
          key={t.id}
          className={`adm-tick is-${t.status}`}
          style={{ height: `${tickHeight(t.durationMs, dense)}px` }}
          title={`${clock(t.createdAt)} · ${t.capabilityName} · ${duration(t.durationMs)}${t.errorCode ? ` · ${t.errorCode}` : ''}`}
        />
      ))}
    </div>
  );
}

/**
 * 时间尺：只标左、中、右三个时刻，够读出这条带子覆盖的时间窗。
 *
 * 必须带日期。快照横跨好几天时，只写 HH:MM 会出现「00:01 → 16:10 → 00:39」
 * 这种看着倒流的刻度，比不标更误导。
 */
function Ruler({ ticks }: { ticks: DutyTask[] }) {
  if (ticks.length < 2) return <div className="adm-band-ruler" aria-hidden="true" />;
  const first = ticks[0];
  const mid = ticks[Math.floor(ticks.length / 2)];
  const last = ticks[ticks.length - 1];
  return (
    <div className="adm-band-ruler" aria-hidden="true">
      <span>{stamp(first.createdAt)}</span>
      <span>{stamp(mid.createdAt)}</span>
      <span>{stamp(last.createdAt)}</span>
    </div>
  );
}

/** 时刻 → MM-DD HH:MM（时间尺专用，跨天也不会读错顺序） */
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd} ${clock(iso)}`;
}

/**
 * 带内计数。
 *
 * 数字变化时重新挂载触发一次 90ms 的「咔哒」滚动 —— 处置完一条异常后，
 * 计数当场少一位，人的动作在屏幕上留下了痕迹。值没变就不动画。
 */
function Counter({ counter, compact }: { counter: DutyCounter; compact?: boolean }) {
  const show = counter.value === null ? '—' : counter.value.toLocaleString('zh-CN');
  return (
    <Link
      to={counter.to}
      className={`adm-band-counter${counter.tone ? ` is-${counter.tone}` : ''}`}
      title={`${counter.label} · 打开对应列表`}
    >
      <span className="adm-band-counter-label">{compact ? counter.short ?? counter.label : counter.label}</span>
      <span className="adm-band-counter-value" key={show}>
        {show}
      </span>
    </Link>
  );
}

/** 带子读取失败：保留既有数字，同时如实说明这批数字没有刷新 */
function BandFailure({
  error,
  onRetry,
  compact,
}: {
  error: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`adm-band-failure${compact ? ' is-compact' : ''}`} role="status">
      <span>仪表带读取失败：{error}</span>
      <button type="button" onClick={onRetry}>
        重试
      </button>
    </div>
  );
}

/**
 * 机器状态：通道塔。
 *
 * 每行一条线路：名称、模态、状态点与冷却倒计时。冷却中的行有一条 1px
 * 计时线，按「本次观测到的剩余时间」向左退 —— 不假设冷却窗口的长度
 * （后端按模态轮询间隔计算，不是固定值），只如实呈现还差多久。
 */
export function DutyChannelTower({ limit = 3 }: { limit?: number }) {
  const { data } = useDuty();
  const channels = data?.channels ?? [];
  const cooling = channels.filter((c) => isCooling(c));
  const now = useNow(cooling.length > 0 ? 1000 : 30_000);

  const ordered = useMemo(() => {
    const rank = (c: DutyChannel) =>
      isCooling(c, now) ? 0 : !c.enabled ? 2 : !c.protocolKnown ? 3 : 1;
    return channels.slice().sort((a, b) => rank(a) - rank(b));
  }, [channels, now]);

  if (!data) {
    return <div className="adm-empty-inline">通道状态读取中…</div>;
  }
  if (data.mode === 'finance') {
    return (
      <div className="adm-empty-inline">
        财务角色没有模型线路读权限，通道状态不在本视角展示。
      </div>
    );
  }
  if (channels.length === 0) {
    return <div className="adm-empty-inline">还没有配置模型线路，生成会直接失败。</div>;
  }

  return (
    <ul className="adm-tower">
      {ordered.slice(0, limit).map((c) => {
        const coolingNow = isCooling(c, now);
        const remaining = coolingNow && c.coolingUntil ? Date.parse(c.coolingUntil) - now : 0;
        return (
          <li key={c.id} className={`adm-tower-row${coolingNow ? ' is-cooling' : ''}`}>
            <span
              className={`adm-dot${coolingNow ? ' is-warn' : !c.enabled ? ' is-off' : !c.protocolKnown ? ' is-warn' : ' is-ok'}`}
              aria-hidden="true"
            />
            <span className="adm-tower-name" title={c.name}>
              {c.name}
            </span>
            <span className="adm-tower-modality">{MODALITY_LABEL[c.modality] ?? c.modality}</span>
            <span className="adm-tower-state">
              {coolingNow
                ? `冷却 ${countdown(remaining)}`
                : !c.enabled
                  ? '已停用'
                  : !c.protocolKnown
                    ? '协议未实现'
                    : '正常'}
            </span>
            {coolingNow && (
              <span className="adm-tower-line" aria-hidden="true">
                <span style={{ width: `${drainRatio(c.id, remaining)}%` }} />
              </span>
            )}
          </li>
        );
      })}
      {channels.length > limit && (
        <li className="adm-tower-more">
          <Link to="/admin/model-config">还有 {channels.length - limit} 条线路</Link>
        </li>
      )}
    </ul>
  );
}

/**
 * 计时线的宽度：本次观测到的最大剩余时间视为 100%，之后随时间退到 0。
 * 冷却窗口长度由后端按模态计算，前端不臆造一个固定值。
 */
const observedMax = new Map<string, number>();
function drainRatio(id: string, remaining: number): number {
  if (remaining <= 0) return 0;
  const max = Math.max(observedMax.get(id) ?? 0, remaining);
  observedMax.set(id, max);
  return Math.max(0, Math.min(100, (remaining / max) * 100));
}

/** 每 interval 刷新一次的当前时间，仅用于冷却倒计时 */
function useNow(interval: number): number {
  const [now, setNow] = useState(() => Date.now());
  const intervalRef = useRef(interval);
  intervalRef.current = interval;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalRef.current);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** 最早的一条失败任务 —— 主动作「接手最早异常」的对象 */
export function earliestFailure(tasks: DutyTask[]): DutyTask | null {
  let pick: DutyTask | null = null;
  for (const t of tasks) {
    if (t.status !== 'failed') continue;
    if (!pick || Date.parse(t.createdAt) < Date.parse(pick.createdAt)) pick = t;
  }
  return pick;
}

function tickHeight(durationMs: number, dense?: boolean): number {
  const min = dense ? 4 : 8;
  const max = dense ? 14 : 24;
  const clamped = Math.min(Math.max(durationMs, 0), 60_000);
  const ratio = Math.log1p(clamped / 1000) / Math.log1p(60);
  return Math.round(min + (max - min) * ratio);
}

function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

function countdown(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

export function duration(ms: number): string {
  if (ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.round(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes < 60) return `${minutes}分${seconds}秒`;
  /* 失败任务的耗时可能是几十分钟到几小时：只到「分」会把 46 小时写成 2779 分 */
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}小时${rest}分` : `${hours}小时`;
}
