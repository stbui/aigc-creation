import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { cn } from '../lib/cn';
import { isCooling, useDuty, type DutyChannel, type DutyTask } from '../../components/admin/DutyContext';

/**
 * 值班塔（概览首屏）与值班数据的展示辅助。
 *
 * 数据来自 `DutyContext`（30 秒轮询），只有概览页消费 —— 不挂在外壳上，
 * 否则 30 多个与它无关的页面都要陪着轮询这批任务。
 */

const CAPABILITY_LABEL: Record<string, string> = {
  image: '文生图',
  text: '文生文',
  video: '文生视频',
  audio: '音频',
};

const STATE_TONE = {
  ok: 'bg-success-text',
  warn: 'bg-warn-text',
  off: 'bg-border',
} as const;

/**
 * 通道状态塔。
 *
 * 每行一条线路：名称、模态、状态点与冷却倒计时。冷却中的行有一条 1px 计时线，
 * 按「本次观测到的剩余时间」向左退 —— 不假设冷却窗口长度（后端按模态计算，
 * 不是固定值），只如实呈现还差多久。
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
    return <p className="py-6 text-xs text-muted-foreground">通道状态读取中…</p>;
  }
  if (data.mode === 'finance') {
    return (
      <p className="py-6 text-xs text-muted-foreground">
        财务角色没有模型线路读权限，通道状态不在本视角展示。
      </p>
    );
  }
  if (channels.length === 0) {
    return (
      <p className="py-6 text-xs text-muted-foreground">还没有配置模型线路，生成会直接失败。</p>
    );
  }

  return (
    <ul className="m-0 list-none p-0">
      {ordered.slice(0, limit).map((c) => {
        const coolingNow = isCooling(c, now);
        const remaining = coolingNow && c.coolingUntil ? Date.parse(c.coolingUntil) - now : 0;
        const tone = coolingNow ? 'warn' : !c.enabled ? 'off' : !c.protocolKnown ? 'warn' : 'ok';
        return (
          <li
            key={c.id}
            className="flex flex-wrap items-center gap-2 border-t border-border py-[9px] text-xs first:border-t-0"
          >
            <span
              className={cn('size-1.5 shrink-0 rounded-full', STATE_TONE[tone])}
              aria-hidden
            />
            <span
              className="max-w-[46%] flex-[0_1_auto] truncate font-medium text-foreground"
              title={`${c.channelName} · ${c.name}`}
            >
              {c.name}
            </span>
            <span className="flex-none text-[10.5px] text-muted-foreground">
              {CAPABILITY_LABEL[c.modality] ?? c.modality}
            </span>
            <span
              className={cn(
                'ml-auto flex-none text-[11px] text-muted-foreground',
                coolingNow && 'text-warn-text',
              )}
            >
              {coolingNow
                ? `冷却 ${countdown(remaining)}`
                : !c.enabled
                  ? '已停用'
                  : !c.protocolKnown
                    ? '协议未实现'
                    : '正常'}
            </span>
            {coolingNow && (
              <span className="h-px flex-[1_0_100%] overflow-hidden bg-border" aria-hidden>
                <span
                  className="block h-px bg-warn-text transition-[width] duration-700 ease-linear"
                  style={{ width: `${drainRatio(c.id, remaining)}%` }}
                />
              </span>
            )}
          </li>
        );
      })}
      {channels.length > limit && (
        <li className="border-t border-border pt-2 text-[11.5px]">
          <Link
            to="/admin/channels"
            className="text-muted-foreground no-underline hover:text-brand"
          >
            还有 {channels.length - limit} 条线路
          </Link>
        </li>
      )}
    </ul>
  );
}

/**
 * 计时线的宽度：本次观测到的最大剩余时间视为 100%，之后随时间退到 0。
 * 冷却窗口长度由后端按模态计算，前端不臆造固定值。
 */
const observedMax = new Map<string, number>();
function drainRatio(id: string, remaining: number): number {
  if (remaining <= 0) return 0;
  const max = Math.max(observedMax.get(id) ?? 0, remaining);
  observedMax.set(id, max);
  return Math.max(0, Math.min(100, (remaining / max) * 100));
}

/** 每 interval 刷新一次的当前时间，仅用于冷却倒计时。 */
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

function countdown(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

/** 最早的一条失败任务 —— 主动作「接手最早异常」的对象。 */
export function earliestFailure(tasks: DutyTask[]): DutyTask | null {
  let pick: DutyTask | null = null;
  for (const t of tasks) {
    if (t.status !== 'failed') continue;
    if (!pick || Date.parse(t.createdAt) < Date.parse(pick.createdAt)) pick = t;
  }
  return pick;
}
