import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { isCooling, useDuty, type DutyChannel, type DutyTask } from './DutyContext';

/**
 * 值班数据的展示辅助（后台视觉方向「值班台」）。
 *
 * ## 它是什么
 *
 * 值班数据回答「现在有什么在排队、什么坏了、哪条线路在冷却」。这些数字
 * 由 `DutyContext` 拉取（30 秒轮询），由概览页的 `DutyStrip`（BoardUI 版
 * 值班条）与本页的通道塔消费。
 *
 * ## 为什么这里只剩工具函数
 *
 * 2026-10-30 之前这里还住着旧外壳的常驻值班带（`adm-band` 一族，深色仪表带、
 * 100 根刻度、两档高度）。外壳换成 BoardUI 后带子下线：刻度 / 四个计数 / 主动作
 * 回到概览首屏（`admin-ui/widgets/DutyStrip`），其余页面不再常驻一条带子。
 * 那份实现随 P4 一并删除，本模块只留下仍在被消费的纯函数。
 */

const CAPABILITY_LABEL: Record<string, string> = {
  image: '文生图',
  text: '文生文',
  video: '文生视频',
  audio: '音频',
};

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
            <span className="adm-tower-name" title={`${c.channelName} · ${c.name}`}>
              {c.name}
            </span>
            <span className="adm-tower-modality">{CAPABILITY_LABEL[c.modality] ?? c.modality}</span>
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
          <Link to="/admin/channels">还有 {channels.length - limit} 条线路</Link>
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

/** 刻度高度：对数映射耗时。概览首屏（BoardUI 版）与旧带子共用同一套映射 */
export function tickHeight(durationMs: number, dense?: boolean): number {
  const min = dense ? 4 : 8;
  const max = dense ? 14 : 24;
  const clamped = Math.min(Math.max(durationMs, 0), 60_000);
  const ratio = Math.log1p(clamped / 1000) / Math.log1p(60);
  return Math.round(min + (max - min) * ratio);
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
