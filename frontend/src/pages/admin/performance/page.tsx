import { type ReactNode, useCallback } from 'react';
import { adminSystemPerformanceApi } from './api';
import {
  AdminPage,
  cn,
  EmptyState,
  ListError,
  Meter,
  Notice,
  Panel,
  RefreshButton,
  SkeletonPanel,
  StaleError,
} from './components';
import {
  ARCH_LABELS,
  ENV_LABELS,
  PLATFORM_LABELS,
  REQUEST_KIND_LABELS,
  STORAGE_BACKEND_LABELS,
  TASK_STATUS_LABELS,
} from './constants';
import { useAdminResource } from './hooks';
import type { AdminSystemPerformance } from './types';
import {
  coolingSummary,
  countSummary,
  durationOrDash,
  eventLoopHint,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatNumber,
  heapUsageHint,
  heapUsagePct,
  labelOf,
  loadavgText,
  pct,
  successRateHint,
} from './utils';

/**
 * 系统信息（`/admin/performance`）—— 从系统设置拆出的独立只读页面。
 *
 * 排版统一成「标签：值」一行一条：值班时要读的是「这台机器叫什么、库在哪、
 * 多大、迁移到哪一版」，两列网格会让人横向跳着找，长值（库路径、CPU 型号）
 * 还会被截断。一条一行可以整块复制，也保证同一份数据在告警页与本页读起来一致。
 *
 * 数字全部来自后端 `SystemPerformanceService`，页面不做二次聚合 —— 同一指标
 * 两处计算迟早和告警、财务页对不上。取不到的值一律显示「—」，不写 0：
 * 值班时 0 会被读成「快得没问题」「库是空的」。
 *
 * 状态、环境、平台、后端与调用类型都先过一层文案映射：页面呈现的是业务结论，
 * 不是 `production` / `darwin` / `succeeded` 这类内部取值。映射集中在 `constants.ts`。
 *
 * 不做定时轮询：打开页面采集一次快照，要新数据点「刷新」。瞬时量靠轮询盯着看
 * 没有意义，反而会让这张页在后台标签页里持续打接口，给数据库和云存储添常驻探针。
 */
export function AdminPerformancePage() {
  const fetcher = useCallback(() => adminSystemPerformanceApi.read(), []);
  const { data, loading, error, reload } = useAdminResource<AdminSystemPerformance>(fetcher, []);

  const description =
    '机器、应用进程、数据库与存储的当前读数，以及近 24 小时的任务和上游调用。打开时采集一次，需要最新数据请点「刷新」。';

  if (loading && !data) {
    return (
      <AdminPage title="系统信息" description={description}>
        <SkeletonPanel rows={4} />
        <SkeletonPanel rows={6} />
        <SkeletonPanel rows={6} />
        <SkeletonPanel rows={4} />
        <SkeletonPanel rows={8} />
      </AdminPage>
    );
  }
  if (error && !data) {
    return (
      <AdminPage title="系统信息" description={description}>
        <ListError error={error} onRetry={() => void reload()} />
      </AdminPage>
    );
  }
  if (!data) {
    return (
      <AdminPage title="系统信息" description={description}>
        <EmptyState
          title="没有取到系统快照"
          description="点「刷新」重新采集；仍为空时请确认后端服务已启动。"
          action={<RefreshButton loading={loading} onRefresh={reload} />}
        />
      </AdminPage>
    );
  }

  return (
    <AdminPage title="系统信息" description={description}>
      {error && <StaleError error={error} onRetry={() => void reload()} />}
      {!data.database.ok && (
        <Notice tone="danger" title="数据库连接失败">
          <p>{data.database.message ?? '本次查询没有返回结果。'}</p>
          <p>请确认库文件存在、磁盘空间充足，然后点「刷新」重试。</p>
        </Notice>
      )}
      <SnapshotBar generatedAt={data.generatedAt} durationMs={data.durationMs} />
      <SystemSection system={data.system} />
      <RuntimeSection runtime={data.runtime} />
      <DatabaseSection database={data.database} />
      <StorageSection storage={data.storage} />
      <TrafficSection traffic={data.traffic} />
      <div className="mt-2 flex items-center justify-end">
        <RefreshButton loading={loading} onRefresh={reload} />
      </div>
    </AdminPage>
  );
}

function SnapshotBar({ generatedAt, durationMs }: { generatedAt: string; durationMs: number }) {
  return (
    <p className="mb-4 text-[12px] leading-5 text-radar-ink-400">
      采集于 {formatDateTime(generatedAt)}，本次采集用时 {formatNumber(durationMs)} ms
    </p>
  );
}

/* ── 宿主机 ───────────────────────────────────────────────── */

function SystemSection({ system }: { system: AdminSystemPerformance['system'] }) {
  return (
    <Panel title="宿主机" note="整台机器的规格与负载；应用进程自身的占用见「运行时」">
      <Rows
        items={[
          { label: '主机名', value: system.hostname },
          { label: '操作系统', value: labelOf(PLATFORM_LABELS, system.platform) },
          { label: '内核版本', value: system.kernel },
          { label: '架构', value: labelOf(ARCH_LABELS, system.arch) },
          { label: 'CPU 型号', value: system.cpu.model },
          { label: 'CPU 核数', value: `${system.cpu.cores} 核` },
          { label: '内存总量', value: formatBytes(system.totalMemoryBytes) },
          { label: '负载均值', value: loadavgText(system.loadavg) },
        ]}
      />
    </Panel>
  );
}

/* ── 运行时：本 Node 进程 ─────────────────────────────────── */

function RuntimeSection({ runtime }: { runtime: AdminSystemPerformance['runtime'] }) {
  const heapPct = heapUsagePct(runtime.memory.heapUsedBytes, runtime.memory.heapTotalBytes);
  const heap = heapUsageHint(heapPct);
  const lag = eventLoopHint(runtime.eventLoopLagMs);
  return (
    <Panel
      title="运行时"
      note="仅本应用进程；常驻内存（RSS）是进程实际占用的物理内存，堆内存是其中由 JS 引擎管理、可回收的部分"
    >
      <Rows
        items={[
          { label: '运行环境', value: labelOf(ENV_LABELS, runtime.env) },
          { label: '应用版本', value: runtime.version },
          { label: 'Node 版本', value: runtime.node },
          { label: '进程号', value: String(runtime.pid) },
          { label: '已运行', value: formatDuration(runtime.uptimeSec * 1000) },
          { label: '常驻内存（RSS）', value: formatBytes(runtime.memory.rssBytes) },
          {
            label: '堆内存',
            value: `${formatBytes(runtime.memory.heapUsedBytes)} / ${formatBytes(runtime.memory.heapTotalBytes)}（已用 / 已分配）`,
          },
          { label: '堆外内存', value: formatBytes(runtime.memory.externalBytes) },
          {
            label: '事件循环延迟',
            value: `${runtime.eventLoopLagMs.toFixed(1)} ms${lag.hint ? `（${lag.hint}）` : ''}`,
            tone: lag.tone,
          },
          { label: 'CPU 用户态累计', value: formatDuration(runtime.cpu.userMs) },
          { label: 'CPU 内核态累计', value: formatDuration(runtime.cpu.systemMs) },
        ]}
      />
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[12px] text-radar-ink-500">
          <span>堆使用率</span>
          <span className="tabular-nums text-radar-ink-900">
            {heapPct}%{heap.hint ? `（${heap.hint}）` : ''}
          </span>
        </div>
        <Meter
          value={heapPct}
          tone={heap.tone ?? 'success'}
          label={`堆使用率 ${heapPct}%${heap.hint ? `，${heap.hint}` : ''}`}
        />
      </div>
    </Panel>
  );
}

/* ── 数据库 ───────────────────────────────────────────────── */

function DatabaseSection({ database }: { database: AdminSystemPerformance['database'] }) {
  const migrations = database.migrations;
  return (
    <Panel title="数据库" note="当前连接的库、版本、体积与迁移进度">
      <Rows
        items={[
          { label: '引擎', value: database.engine },
          { label: '版本', value: database.version ?? '—' },
          { label: '库位置', value: database.location ?? '—', breakAll: true },
          {
            label: '库体积',
            value:
              database.sizeBytes === null
                ? '—（网络数据库不按文件计体积）'
                : formatBytes(database.sizeBytes),
          },
          {
            label: '表数量',
            value: database.tables === null ? '—' : formatNumber(database.tables),
          },
          {
            label: '迁移进度',
            value: migrations
              ? `已应用 ${formatNumber(migrations.applied)} / 共 ${formatNumber(migrations.total)}，最后一次 ${formatDateTime(migrations.lastAppliedAt)}`
              : '—',
            tone: migrations && migrations.applied < migrations.total ? 'warn' : undefined,
          },
          { label: '查询延迟', value: `${formatNumber(database.latencyMs)} ms（一次往返）` },
        ]}
      />
    </Panel>
  );
}

/* ── 存储 ─────────────────────────────────────────────────── */

function StorageSection({ storage }: { storage: AdminSystemPerformance['storage'] }) {
  return (
    <Panel title="存储" note="素材实际存放位置的可读可写检查">
      <Rows
        items={[
          { label: '后端', value: labelOf(STORAGE_BACKEND_LABELS, storage.backend) },
          {
            label: '连通',
            value: storage.ok ? `正常，${formatNumber(storage.latencyMs)} ms` : '失败',
            tone: storage.ok ? undefined : 'danger',
          },
          {
            label: '检查结果',
            value: storage.message ?? (storage.ok ? '—' : '未返回原因'),
            breakAll: true,
          },
          {
            label: '结果来源',
            value: storage.cached ? '复用 30 秒内的检查结果' : '本次实测',
          },
        ]}
      />
    </Panel>
  );
}

/* ── 近 24 小时任务与调用 ─────────────────────────────────── */

function TrafficSection({ traffic }: { traffic: AdminSystemPerformance['traffic'] }) {
  const rate = traffic.tasks.successRate;
  const rateHint = successRateHint(rate);
  return (
    <Panel
      title={`近 ${traffic.windowHours} 小时任务与调用`}
      note="任务耗时为创建到终态，调用耗时为一次请求往返。P95 按最近邻取值，不插值。标注「全量」的行不受时间窗口限制"
    >
      <Rows
        items={[
          { label: '任务总量', value: formatNumber(traffic.tasks.total) },
          {
            label: '任务成功 / 失败',
            // 窗口内一个任务都没有时，0 / 0 会被读成「全都成功」，要说清是没有样本
            value:
              traffic.tasks.total === 0
                ? '—（窗口内没有任务）'
                : `${formatNumber(traffic.tasks.succeeded)} / ${formatNumber(traffic.tasks.failed)}`,
          },
          {
            label: '任务成功率',
            value: `${pct(rate)}${rateHint.hint ? `（${rateHint.hint}）` : ''}`,
            tone: rateHint.tone,
          },
          { label: '任务 P95 耗时', value: durationOrDash(traffic.tasks.p95DurationMs) },
          // 后端给的任务状态是全量口径，与同面板的 24h 读数不同窗口，不标出来会被读成同一件事
          {
            label: '任务状态（全量）',
            value: countSummary(traffic.tasks.byStatus, TASK_STATUS_LABELS),
            breakAll: true,
          },
          { label: '上游调用', value: formatNumber(traffic.calls.total) },
          {
            label: '调用成功 / 失败',
            value:
              traffic.calls.total === 0
                ? '—（窗口内没有调用）'
                : `${formatNumber(traffic.calls.terminal - traffic.calls.failed)} / ${formatNumber(traffic.calls.failed)}`,
          },
          { label: '调用 P95 耗时', value: durationOrDash(traffic.calls.p95DurationMs) },
          {
            label: '调用类型',
            value: countSummary(traffic.calls.byKind, REQUEST_KIND_LABELS),
            breakAll: true,
          },
          {
            label: '线路冷却',
            value:
              traffic.cooling.blocked > 0
                ? `${formatNumber(traffic.cooling.blocked)} 条 · ${coolingSummary(traffic.cooling.keys)}`
                : '无',
            tone: traffic.cooling.blocked > 0 ? 'warn' : undefined,
            breakAll: true,
          },
          {
            label: '素材（全量）',
            value: `${formatNumber(traffic.storage.assets)} 个，共 ${formatBytes(traffic.storage.bytes)}`,
          },
        ]}
      />
    </Panel>
  );
}

/* ── 展示件与格式化 ───────────────────────────────────────── */

/** 一行一条「标签：值」。标签定宽对齐，长值换行不截断，方便整块复制。 */
function Rows({
  items,
}: {
  items: Array<{ label: string; value: ReactNode; tone?: 'danger' | 'warn'; breakAll?: boolean }>;
}) {
  return (
    <dl className="flex flex-col gap-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-2 text-[12px] leading-5">
          <dt className="w-28 shrink-0 text-radar-ink-500">{item.label}：</dt>
          <dd
            className={cn(
              'min-w-0 flex-1 tabular-nums text-radar-ink-900',
              item.breakAll && 'break-all',
              item.tone === 'danger' && 'text-radar-alert',
              item.tone === 'warn' && 'text-radar-code',
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
