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
  adminBillingOrdersApi,
  adminChannelsApi,
  adminInvoicesApi,
  adminOrdersApi,
  adminPaymentReconciliationApi,
  adminTasksApi,
} from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import type { AdminOrderRow, AdminTaskCongestion } from '../../types/api';
import type { ChannelHealthRowView } from '../../types/model';

/**
 * 值班带数据源（后台视觉方向「值班台」）。
 *
 * ## 为什么做成 Context 而不是各页各拉
 *
 * 值班带只在概览首屏渲染（`AdminDashboardContent`），概览页的异常队列、
 * 机器状态又都源自同一批任务。若带子与页面各拉一次，同一屏会
 * 出现两份「最近 100 条任务」，刷新节奏不同时还会互相打架（带子里异常 6、
 * 队列里 5）。
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
  /** 主动作文案；带子从非零计数里按 actionPriority 挑一个，跟着数据走 */
  action?: string;
  /** 主动作优先级，数值越大越先接手；未声明视为 0 */
  actionPriority?: number;
}

/** 值班带刻度用的任务快照，字段只保留画刻度与排异常队列需要的 */
export interface DutyTask {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  capabilityName: string;
  errorCode: string | null;
  durationMs: number;
  createdAt: string;
  thumbnailUrl: string | null;
}

/**
 * 一条线路 = 一条**渠道模型**（新模型层的最小调度单位）。
 *
 * 渠道停用会连坐其下模型，所以 `enabled` 是两者相与后的结果；渠道模型各自
 * 冷却 —— 404 只冻结那一条模型，不冻结整家渠道。
 */
export interface DutyChannel {
  id: string;
  name: string;
  /** 所属渠道名，用于同模态下区分来源 */
  channelName: string;
  /** 渠道模型的能力：text / image / video，协议目录里还可能有 audio */
  modality: string;
  enabled: boolean;
  /** 协议在当前进程的注册表里是否存在；false 的线路一旦启用必然失败 */
  protocolKnown: boolean;
  coolingUntil: string | null;
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

/** 轮询间隔。任务页的拥堵条也是 30 秒，两处节奏一致，排障时不会对不上 */
const POLL_MS = 30_000;

export function AdminDutyProvider({ children }: { children: ReactNode }) {
  const { can } = useAdmin();
  const canTasks = can('task.read');
  const canOrders = can('order.read');
  const canChannels = can('channel.read');
  const canBilling = can('billing_order.read');

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
            : await fetchFinanceDuty(canChannels, canBilling);
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
    [mode, canChannels, canBilling],
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
    fetchChannels ? adminChannelsApi.health().catch(() => null) : Promise.resolve(null),
  ]);

  const tasks: DutyTask[] = list.result.items.map((t) => ({
    id: t.id,
    status: t.status,
    capabilityName: t.capabilityName,
    errorCode: t.errorCode,
    durationMs: t.durationMs,
    createdAt: t.createdAt,
    thumbnailUrl: t.thumbnailUrl,
  }));

  const channels = toDutyChannels(channelSnapshot);
  const cooling = channels.filter((c) => isCooling(c)).length;
  const congestion = list.congestion;

  return {
    mode: 'tasks',
    counters: [
      {
        key: 'queued',
        label: '等待',
        value: congestion.queued,
        tone: congestion.queued > 0 ? 'warn' : undefined,
        to: '/admin/tasks?status=queued',
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
        to: '/admin/channels',
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

/**
 * 财务模式。
 *
 * 五个计数各取一页 `pageSize=1` 的列表，只用返回的 total —— 不为这几个
 * 数字扩展 overview 接口。待付订单额外取 6 条作为概览待办队列。
 *
 * 「账单待核对」只有拿到 `billing_order.read` 才请求：自定义角色可能给了
 * 订单读权却没有账单读权，无条件请求会让 403 把整条带子打掉。
 */
async function fetchFinanceDuty(
  fetchChannels: boolean,
  fetchBilling: boolean,
): Promise<DutyData> {
  const [pendingOrders, refunding, uncertainBills, invoices, reconcile, channelSnapshot] =
    await Promise.all([
      adminOrdersApi.list({ status: 'pending', pageSize: 6, page: 1 }),
      adminOrdersApi.list({ refundState: 'processing', pageSize: 1, page: 1 }),
      fetchBilling
        ? adminBillingOrdersApi.list({ status: 'uncertain', pageSize: 1, page: 1 })
        : Promise.resolve(null),
      adminInvoicesApi.list({ status: 'pending', limit: 1 }),
      adminPaymentReconciliationApi.list({ status: 'failed', pageSize: 1, page: 1 }),
      fetchChannels ? adminChannelsApi.health().catch(() => null) : Promise.resolve(null),
    ]);

  const channels = toDutyChannels(channelSnapshot);

  return {
    mode: 'finance',
    counters: [
      {
        key: 'pendingOrders',
        label: '待付订单',
        value: pendingOrders.total,
        to: '/admin/orders?status=pending',
        action: '处理待付订单',
        actionPriority: 10,
      },
      {
        key: 'refunding',
        label: '退款处理中',
        short: '退款中',
        value: refunding.total,
        tone: refunding.total > 0 ? 'warn' : undefined,
        to: '/admin/orders?refundState=processing',
        action: '跟进出口退款',
        actionPriority: 40,
      },
      ...(uncertainBills
        ? [
            {
              key: 'uncertainBills',
              label: '账单待核对',
              short: '待核对',
              value: uncertainBills.total,
              tone: (uncertainBills.total > 0 ? 'warn' : undefined) as 'warn' | undefined,
              to: '/admin/billing-orders?status=uncertain',
              action: '核对结果不明账单',
              actionPriority: 50,
            },
          ]
        : []),
      {
        key: 'invoices',
        label: '待开发票',
        short: '待开票',
        value: invoices.total,
        tone: invoices.total > 0 ? 'warn' : undefined,
        to: '/admin/invoices?status=pending',
        action: '审核待开发票',
        actionPriority: 20,
      },
      {
        key: 'reconcile',
        label: '对账运行失败',
        short: '对账失败',
        value: reconcile.total,
        tone: reconcile.total > 0 ? 'warn' : undefined,
        to: '/admin/payments?tab=reconciliation&status=failed',
        action: '查看对账运行失败',
        actionPriority: 30,
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

/**
 * 线路健康投影 → 塔上的行。
 *
 * 取不到数据时给空数组：值班塔显示「还没有配置模型线路」比一直转圈诚实，
 * 而且渠道读权失败本就不该把整条带子打掉。
 */
function toDutyChannels(snapshot: { items: ChannelHealthRowView[] } | null): DutyChannel[] {
  if (!snapshot) return [];
  return snapshot.items.map((row) => ({
    id: row.id,
    name: row.name,
    channelName: row.channelName,
    modality: row.capability,
    enabled: row.enabled,
    protocolKnown: row.protocolKnown,
    coolingUntil: row.coolingUntil,
  }));
}

export function isCooling(channel: DutyChannel, now = Date.now()): boolean {
  if (!channel.coolingUntil) return false;
  const until = Date.parse(channel.coolingUntil);
  return Number.isFinite(until) && until > now;
}
