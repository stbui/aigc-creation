import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  adminInvoicesApi,
  adminModelChannelsApi,
  adminOrdersApi,
  adminReconciliationApi,
  adminTasksApi,
} from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import type {
  AdminModelChannelsSnapshot,
  AdminOrderRow,
  AdminTaskCongestion,
  Modality,
} from '../../types/api';

/**
 * 值班带数据源（后台视觉方向「值班台」）。
 *
 * ## 为什么做成 Context 而不是各页各拉
 *
 * 值班带常驻在 29 个页面的顶部，概览页的异常队列、机器状态、产出条又都
 * 源自同一批任务。若外壳与页面各拉一次，同一屏会出现两份「最近 100 条
 * 任务」，刷新节奏不同时还会互相打架（带子里异常 6、队列里 5）。
 * 这里只拉一次，带子与页面读同一份快照。
 *
 * ## 按角色裁剪
 *
 * 财务没有 `task.read`，值班带改取订单 / 退款 / 发票 / 对账四个计数，
 * 不请求任务接口，也不显示空壳槽位。角色既无任务读权也无订单读权时
 * 整个带子不渲染（Provider 返回 null 模式）。
 */

export type DutyMode = 'tasks' | 'finance';

/** 带子上的一个计数。value 为 null 表示还没取到（显示「—」，不是 0） */
export interface DutyCounter {
  key: string;
  label: string;
  /** 压缩态（44px）用的短标签，放不下长标签 */
  short?: string;
  value: number | null;
  /** 非零时给数字上色：失败红、等待/冷却琥珀 */
  tone?: 'danger' | 'warn';
  /** 点计数进入对应列表 */
  to: string;
}

/** 值班带刻度用的任务快照，字段只保留画刻度与排异常队列需要的 */
export interface DutyTask {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  capabilityName: string;
  errorCode: string | null;
  provider: string | null;
  durationMs: number;
  createdAt: string;
  thumbnailUrl: string | null;
}

export interface DutyChannel {
  id: string;
  name: string;
  modality: Modality;
  enabled: boolean;
  /** 协议在项目里是否有实现；false 的线路一旦启用必然失败 */
  protocolKnown: boolean;
  coolingUntil: string | null;
  failCount: number;
  lastFailureAt: string | null;
}

export interface DutyData {
  mode: DutyMode;
  counters: DutyCounter[];
  /** 最近任务，新 → 旧。刻度与队列都从这里派生 */
  tasks: DutyTask[];
  total: number | null;
  congestion: AdminTaskCongestion | null;
  channels: DutyChannel[];
  /** 冷却中的通道数（按 cooldownUntil 实时判定，不用后端的冷却计数快照） */
  cooling: number;
  /** 财务模式：待付订单前 6 条，作为概览的待办队列 */
  orders: AdminOrderRow[];
  fetchedAt: string;
}

interface DutyContextValue {
  data: DutyData | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const DutyContext = createContext<DutyContextValue | null>(null);

const MODALITIES: Modality[] = ['image', 'text', 'video'];

/** 轮询间隔。任务页的拥堵条也是 30 秒，两处节奏一致，排障时不会对不上 */
const POLL_MS = 30_000;

export function AdminDutyProvider({ children }: { children: ReactNode }) {
  const { can } = useAdmin();
  const canTasks = can('task.read');
  const canOrders = can('order.read');
  const canChannels = can('model.config_read');

  const mode: DutyMode | null = canTasks ? 'tasks' : canOrders ? 'finance' : null;

  const [data, setData] = useState<DutyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      if (!mode) return;
      const current = ++seq.current;
      if (!silent) setLoading(true);
      try {
        const next =
          mode === 'tasks'
            ? await fetchTaskDuty(canChannels)
            : await fetchFinanceDuty(canChannels);
        if (current !== seq.current) return;
        setData(next);
        setError(null);
      } catch (e) {
        if (current !== seq.current) return;
        // 保留上一份快照：断网时带子继续显示「截至某时」的旧数字，
        // 比整条带子消失更接近值班台的实际需要
        setError(e instanceof Error ? e.message : '值班带数据读取失败');
      } finally {
        if (current === seq.current && !silent) setLoading(false);
      }
    },
    [mode, canChannels],
  );

  useEffect(() => {
    if (!mode) return;
    void load();
    const timer = window.setInterval(() => {
      // 页面不可见时不轮询：值班带不是推送，切回标签页时下一次周期会补齐
      if (document.visibilityState === 'visible') void load(true);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [mode, load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  const value = useMemo<DutyContextValue>(
    () => ({ data, loading, error, reload }),
    [data, loading, error, reload],
  );

  // 两种读权都没有：不进入 Context，页面上也不出现带子
  if (!mode) return <>{children}</>;

  return <DutyContext.Provider value={value}>{children}</DutyContext.Provider>;
}

/**
 * 读值班带快照。未提供 Provider（无任务也无订单读权）时返回空壳，
 * 调用方据此渲染「无数据」而不是报错 —— 带子是可选展示，不该拖垮页面。
 */
export function useDuty(): DutyContextValue {
  return useContext(DutyContext) ?? { data: null, loading: false, error: null, reload: () => {} };
}

async function fetchTaskDuty(fetchChannels: boolean): Promise<DutyData> {
  const [list, channelSnapshot] = await Promise.all([
    adminTasksApi.list({ page: 1, pageSize: 100 }),
    fetchChannels ? adminModelChannelsApi.list().catch(() => null) : Promise.resolve(null),
  ]);

  const tasks: DutyTask[] = list.result.items.map((t) => ({
    id: t.id,
    status: t.status,
    capabilityName: t.capabilityName,
    errorCode: t.errorCode,
    provider: t.provider,
    durationMs: t.durationMs,
    createdAt: t.createdAt,
    thumbnailUrl: t.thumbnailUrl,
  }));

  const channels = flattenChannels(channelSnapshot);
  const cooling = channels.filter((c) => isCooling(c)).length;
  const congestion = list.congestion;

  return {
    mode: 'tasks',
    counters: [
      {
        key: 'pending',
        label: '等待',
        value: congestion.pending,
        tone: congestion.pending > 0 ? 'warn' : undefined,
        to: '/admin/tasks?status=pending',
      },
      {
        key: 'running',
        label: '执行中',
        value: congestion.running,
        to: '/admin/tasks?status=running',
      },
      {
        key: 'failed',
        label: '近 1 小时失败',
        short: '1h 失败',
        value: congestion.failedLastHour,
        tone: congestion.failedLastHour > 0 ? 'danger' : undefined,
        to: '/admin/tasks?status=failed',
      },
      {
        key: 'cooling',
        label: '冷却通道',
        short: '冷却',
        value: fetchChannels ? cooling : null,
        tone: cooling > 0 ? 'warn' : undefined,
        to: '/admin/model-config',
      },
    ],
    tasks,
    total: list.result.total,
    congestion,
    channels,
    cooling,
    orders: [],
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchFinanceDuty(fetchChannels: boolean): Promise<DutyData> {
  /*
   * 四个计数各取一页 pageSize=1 / limit=1 的列表，只用返回的 total ——
   * 不为四个数字扩展 overview 接口。待付订单额外取 6 条作为概览待办队列。
   */
  const [pendingOrders, refunding, invoices, reconcile, channelSnapshot] = await Promise.all([
    adminOrdersApi.list({ status: 'pending', pageSize: 6, page: 1 }),
    adminOrdersApi.list({ refundState: 'processing', pageSize: 1, page: 1 }),
    adminInvoicesApi.list({ status: 'pending', limit: 1 }),
    adminReconciliationApi.batches({ status: 'imported', limit: 1 }),
    fetchChannels ? adminModelChannelsApi.list().catch(() => null) : Promise.resolve(null),
  ]);

  const channels = flattenChannels(channelSnapshot);

  return {
    mode: 'finance',
    counters: [
      {
        key: 'pendingOrders',
        label: '待付订单',
        value: pendingOrders.total,
        to: '/admin/orders?status=pending',
      },
      {
        key: 'refunding',
        label: '退款处理中',
        short: '退款中',
        value: refunding.total,
        tone: refunding.total > 0 ? 'warn' : undefined,
        to: '/admin/orders?refundState=processing',
      },
      {
        key: 'invoices',
        label: '待开发票',
        short: '待开票',
        value: invoices.total,
        tone: invoices.total > 0 ? 'warn' : undefined,
        to: '/admin/invoices?status=pending',
      },
      {
        key: 'reconcile',
        label: '未处置对账',
        short: '待对账',
        value: reconcile.total,
        tone: reconcile.total > 0 ? 'warn' : undefined,
        to: '/admin/reconciliation?status=imported',
      },
    ],
    tasks: [],
    total: null,
    congestion: null,
    channels,
    cooling: channels.filter((c) => isCooling(c)).length,
    orders: pendingOrders.items,
    fetchedAt: new Date().toISOString(),
  };
}

function flattenChannels(snapshot: AdminModelChannelsSnapshot | null): DutyChannel[] {
  if (!snapshot) return [];
  const rows: DutyChannel[] = [];
  for (const modality of MODALITIES) {
    const group = snapshot.modalities?.[modality];
    if (!group) continue;
    for (const ch of group.channels) {
      rows.push({
        id: ch.id,
        name: ch.name || ch.model || ch.protocol,
        modality,
        enabled: ch.enabled,
        protocolKnown: ch.protocolKnown,
        coolingUntil: ch.cooldownUntil,
        failCount: ch.failCount,
        lastFailureAt: ch.lastFailureAt,
      });
    }
  }
  return rows;
}

export function isCooling(channel: DutyChannel, now = Date.now()): boolean {
  if (!channel.coolingUntil) return false;
  const until = Date.parse(channel.coolingUntil);
  return Number.isFinite(until) && until > now;
}
