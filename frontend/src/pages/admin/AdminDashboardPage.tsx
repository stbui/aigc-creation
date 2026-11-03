import { lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, Link } from 'react-router-dom';
import { adminApi } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useAdmin } from '../../context/AdminContext';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { findAdminMenuItem } from '../../components/admin/adminNav';
import { AdminUIProvider } from '../../admin-ui/providers/AdminUIProvider';
import { AdminBoardLayout } from '../../admin-ui/shell/AdminBoardLayout';
import '../../styles/admin.css';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { ExceptionPage } from '../../components/ExceptionPage';
import {
  ActionButton,
  Meter,
  PageHeader,
  PageSkeleton,
  Panel,
  SegmentedTabs,
  Skeleton,
  SkeletonDutyStrip,
  StaleError,
  DutyChannelTower,
  DutyStrip,
  TrendBarChart,
  earliestFailure,
  formatDuration,
  useAdminResource,
} from '../../admin-ui/primitives';
import { AdminDutyProvider, useDuty, type DutyTask } from '../../components/admin/DutyContext';
import { assetThumbUrl } from '../../lib/api';
import { taskErrorLabel } from '../../lib/admin-error-codes';
import { adminOrderDetailHref, adminTaskHref } from '../../lib/admin-links';
import type { AdminOrderRow, AdminOverview } from '../../types/api';

/**
 * 后台子路由按页加载。
 *
 * `/admin` 外壳本身已经是懒加载，但此前外壳一次性静态导入全部页面，进入概览
 * 时仍要下载整包后台代码。这里保留外壳与概览同步加载，其余页面在首次导航到
 * 对应路由时再请求各自 chunk；Suspense 放在 AdminLayout 内，加载期间侧栏不
 * 消失，避免整屏闪白。
 */
function lazyAdminPage<T extends Record<string, ComponentType<any>>>(
  loader: () => Promise<T>,
  name: keyof T & string,
) {
  return lazy(() => loader().then((m) => ({ default: m[name] })));
}

const AdminUsersPage = lazyAdminPage(() => import('./users'), 'AdminUsersPage');
const AdminRolesPage = lazyAdminPage(() => import('./roles'), 'AdminRolesPage');
const AdminSettingsPage = lazyAdminPage(() => import('./settings'), 'AdminSettingsPage');
const AdminAuditPage = lazyAdminPage(() => import('./audit-logs'), 'AdminAuditPage');
const AdminBackupPage = lazyAdminPage(() => import('./backups'), 'AdminBackupPage');
const AdminAssetsPage = lazyAdminPage(() => import('./assets'), 'AdminAssetsPage');
const AdminStoragePage = lazyAdminPage(() => import('./storage'), 'AdminStoragePage');
const AdminCouponsPage = lazyAdminPage(() => import('./coupons'), 'AdminCouponsPage');
const AdminCampaignsPage = lazyAdminPage(
  () => import('./campaigns'),
  'AdminCampaignsPage',
);
const AdminMarketingRulesPage = lazyAdminPage(
  () => import('./marketing-rules'),
  'AdminMarketingRulesPage',
);
const AdminSchedulerPage = lazyAdminPage(
  () => import('./scheduler'),
  'AdminSchedulerPage',
);
const AdminModelCallsPage = lazyAdminPage(
  () => import('./model-calls'),
  'AdminModelCallsPage',
);
// 模型层后台六页：渠道工作台 / 前台模型 / 用户分组 / 插件 / 账单
const AdminChannelsPage = lazyAdminPage(() => import('./channels'), 'AdminChannelsPage');
const AdminLogicalModelsPage = lazyAdminPage(
  () => import('./logical-models'),
  'AdminLogicalModelsPage',
);
const AdminUserGroupsPage = lazyAdminPage(
  () => import('./user-groups'),
  'AdminUserGroupsPage',
);
const AdminPluginsPage = lazyAdminPage(() => import('./plugins'), 'AdminPluginsPage');
const AdminBillingOrdersPage = lazyAdminPage(
  () => import('./billing-orders'),
  'AdminBillingOrdersPage',
);
const AdminFinancePage = lazyAdminPage(() => import('./finance'), 'AdminFinancePage');
const AdminCapabilitiesPage = lazyAdminPage(
  () => import('./capabilities'),
  'AdminCapabilitiesPage',
);
const AdminTasksPage = lazyAdminPage(() => import('./tasks'), 'AdminTasksPage');
const AdminTicketsPage = lazyAdminPage(() => import('./tickets'), 'AdminTicketsPage');
const AdminCreditPricesPage = lazyAdminPage(
  () => import('./credit-prices'),
  'AdminCreditPricesPage',
);
const AdminProductsPage = lazyAdminPage(() => import('./products'), 'AdminProductsPage');
const AdminMembershipPlansPage = lazyAdminPage(
  () => import('./membership-plans'),
  'AdminMembershipPlansPage',
);
const AdminOrdersPage = lazyAdminPage(() => import('./orders'), 'AdminOrdersPage');
const AdminCreditsPage = lazyAdminPage(() => import('./credits'), 'AdminCreditsPage');
const AdminRetentionPage = lazyAdminPage(
  () => import('./retention'),
  'AdminRetentionPage',
);
const AdminInvoicesPage = lazyAdminPage(() => import('./invoices'), 'AdminInvoicesPage');
const AdminPaymentsPage = lazyAdminPage(() => import('./payments'), 'AdminPaymentsPage');
const AdminLegalPage = lazyAdminPage(() => import('./legal'), 'AdminLegalPage');
const AdminNotificationsPage = lazyAdminPage(
  () => import('./notifications'),
  'AdminNotificationsPage',
);
const AdminAigcLabelPage = lazyAdminPage(
  () => import('./aigc-label'),
  'AdminAigcLabelPage',
);
const AdminAlertsPage = lazyAdminPage(() => import('./alerts'), 'AdminAlertsPage');

/**
 * 平台概览（值班台）。
 *
 * ## 首屏只回答三件事
 *
 * 有什么坏了（异常队列）→ 机器还在不在转（机器状态）→ 最近产出了什么
 * （产出条）。累计指标下沉到下方区块，不与「需要动作」的东西同权重。
 *
 * ## 与值班条同源
 *
 * 值班条与这里的队列读同一份 DutyContext 快照，不会出现「带子里 6 条异常、
 * 队列里 5 条」。财务没有 `task.read`：队列换成待付订单，机器状态换成交易
 * 指标，不请求任务接口。
 */
function DashboardContent() {
  const [days, setDays] = useState<number>(7);
  /*
   * 切换时间窗与「重试」都走同一份资源：换窗口时旧数据留在屏幕上直到新数据
   * 到位，不再整页塌成骨架屏 —— 概览页塌一次，用户会以为刚看到的数字丢了。
   */
  const { data, loading, error, reload } = useAdminResource(
    () => adminApi.overview(days),
    [days],
  );
  const { data: duty } = useDuty();
  const { can } = useAdmin();
  /* 财务没有任务读权：队列、产出条、任务趋势整体换成交易视角 */
  const isFinance = !can('task.read');

  /*
   * 首屏骨架：只有完全没有数据时才塌**正文**。
   *
   * 页头照常渲染 —— 概览页是后台的门面，加载期间连标题都没有的话，用户会以为
   * 后台没打开。时间窗分段与「刷新」按钮也在位（禁用），数据到位后它们不动。
   */
  if (loading && !data) {
    return (
      <PageSkeleton
        title="平台概览"
        description={`${isFinance ? '经营' : '生成与经营'} · 近 ${days} 天`}
        actions={
          <>
            <SegmentedTabs
              ariaLabel="统计时间窗"
              value={String(days)}
              onChange={(value) => setDays(Number(value))}
              options={[7, 30, 90].map((value) => ({
                value: String(value),
                label: `近 ${value} 天`,
              }))}
            />
            <ActionButton variant="outline" icon={RefreshCw} disabled>
              刷新
            </ActionButton>
          </>
        }
        /*
         * 概览页的真实版面不是「面板上下排」：值班条 + 62/38 双栏 + 一串
         * 折叠小节。用通用面板骨架顶上去，数据到位时整页会横向重排一次 ——
         * 所以这里自己画一份同构的骨架。
         */
        body={
          <>
            <SkeletonDutyStrip />
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,62fr)_minmax(0,38fr)]">
              <Panel title="队列" note="读取中…">
                <Skeleton rows={4} />
              </Panel>
              <Panel title="机器状态" note="读取中…">
                <Skeleton rows={3} />
              </Panel>
            </div>
          </>
        }
      />
    );
  }
  if (error && !data) {
    return (
      <ExceptionPage
        kind="warning"
        title="统计数据加载失败"
        desc="概览数据未能加载，下方是后端返回的原因。确认服务可用后重试即可，不会影响已产生的任何数据。"
        detail={error}
        action={
          <ActionButton variant="default" onClick={() => void reload()}>
            重试
          </ActionButton>
        }
        showBack={false}
      />
    );
  }
  if (!data) return null;

  const c = data.commerce;
  const w = data.window;
  const tasks = duty?.tasks ?? [];
  /*
   * 带子上的「近 1 小时失败」与队列里的失败不是同一个时间窗：队列是最新
   * 100 条任务快照里的全部失败。把最早那条的时刻写到标题旁，读的人不用
   * 自己对「带子说 0、队列有 4 条」这件事。
   */
  const firstFailure = earliestFailure(tasks);

  return (
    <>
      <PageHeader
        title="平台概览"
        description={`${isFinance ? '经营' : '生成与经营'} · 近 ${days} 天 · 截至 ${hhmm(
          data.generatedAt,
        )} · 每 ${data.cacheTtlSeconds} 秒刷新`}
        actions={
          <>
            <SegmentedTabs
              ariaLabel="统计时间窗"
              value={String(days)}
              onChange={(value) => setDays(Number(value))}
              options={[7, 30, 90].map((value) => ({
                value: String(value),
                label: `近 ${value} 天`,
              }))}
            />
            <ActionButton
              variant="outline"
              icon={RefreshCw}
              disabled={loading}
              onClick={() => void reload()}
            >
              {loading ? '刷新中…' : '刷新'}
            </ActionButton>
          </>
        }
      />

      {/* 换时间窗失败时保留上一窗口的数字，但要明说这是旧的 */}
      {error && <StaleError error={error} onRetry={() => void reload()} />}

      <DutyStrip />

      {/*
       * 首屏双栏：左 62% 给需要动作的队列，右 38% 给机器状态。
       * 不等分 —— 队列是「要做的事」，通道是「要确认的环境」，前者优先。
       */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,62fr)_minmax(0,38fr)]">
        {isFinance ? (
          <Panel
            title="待办队列"
            note={duty ? `最早 ${duty.orders.length} 笔待付 · 按创建时间` : '读取中…'}
            extra={
              <Link className="text-xs text-brand hover:underline" to="/admin/orders?status=pending">
                全部待付订单
              </Link>
            }
          >
            <OrderQueue orders={duty?.orders ?? []} loading={!duty} />
          </Panel>
        ) : (
          <Panel
            title="异常队列"
            note={
              duty
                ? `最近 ${tasks.length} 条任务中的失败${
                    firstFailure ? ` · 最早 ${queueTime(firstFailure.createdAt)}` : ' · 无'
                  }`
                : '读取中…'
            }
            extra={
              <Link className="text-xs text-brand hover:underline" to="/admin/tasks?status=failed">
                全部失败任务
              </Link>
            }
          >
            <FailureQueue tasks={tasks} loading={!duty} />
          </Panel>
        )}

        <Panel
          title="机器状态"
          note={
            isFinance
              ? `近 ${days} 天汇总`
              : duty
                ? duty.cooling > 0
                  ? `${duty.cooling} 条线路冷却中`
                  : '线路全部可用'
                : '读取中…'
          }
          extra={
            !isFinance && can('channel.read') ? (
              <Link className="text-xs text-brand hover:underline" to="/admin/channels">
                渠道工作台
              </Link>
            ) : undefined
          }
        >
          {isFinance ? (
            <FinanceGrid commerce={c} days={days} />
          ) : (
            <div className="flex flex-col gap-3.5">
              <DutyChannelTower limit={4} />
              <MachineStats tasks={tasks} />
            </div>
          )}
        </Panel>
      </div>

      {/*
       * 窗口表现：与首屏的实时读数分开。
       * 「任务总量 / 成功率」是历史累计，运营真正要看的是「最近这一档在变好
       * 还是变坏」，所以环比用紧邻的等长窗口做分母。
       */}
      <Fold>
        <Panel title={`近 ${days} 天`} note={`对比上一个 ${days} 天`}>
          <WindowStrip data={data} isFinance={isFinance} />
        </Panel>
      </Fold>

      {/*
       * 累计指标只回答「平台现在有多大」，与上方窗口表现分开。
       * 财务没有 task.read，因此不在这里重新引入任务成功率；改为累计实收，
       * 保持交易视角完整，也不让同一页出现两套相互竞争的任务口径。
       */}
      <Fold>
        <Panel title="平台存量" note="累计口径 · 不受上方时间窗影响">
          <TotalsStrip data={data} isFinance={isFinance} />
        </Panel>
      </Fold>

      {!isFinance && (
        <Fold>
          <Panel
            title="最近产出"
            note={`最近 ${tasks.length} 条任务里的成功产出 · 最多 ${FRAME_LIMIT} 张`}
            extra={
              <Link className="text-xs text-brand hover:underline" to="/admin/tasks">
                前往任务监控
              </Link>
            }
          >
            <OutputStrip tasks={tasks} />
          </Panel>
        </Fold>
      )}

      {!isFinance && (
        <Fold>
          <Panel title="任务趋势" note={`近 ${days} 天 · 有失败的日子标红`}>
            <TrendBarChart
              ariaLabel={`近 ${days} 天每日任务量`}
              empty="所选窗口内没有任务记录"
              items={data.trend.map((d) => ({
                key: d.date,
                date: d.date,
                value: d.total,
                title: `${d.date} · ${d.total} 个任务 · 失败 ${d.failed}`,
                warn: d.failed > 0,
              }))}
            />
          </Panel>
        </Fold>
      )}

      {!isFinance && (
        <Fold>
          <Panel
            title="失败原因"
            note={
              w.failed > 0 ? `近 ${days} 天共 ${w.failed} 条失败` : `近 ${days} 天没有失败任务`
            }
            extra={
              w.failed > 0 ? (
                <Link className="text-xs text-brand hover:underline" to="/admin/tasks?status=failed">
                  查看失败任务
                </Link>
              ) : undefined
            }
          >
            {w.failed === 0 ? (
              <EmptyInline>近 {days} 天没有失败任务</EmptyInline>
            ) : (
              <div className="flex flex-col gap-2.5">
                {w.failureReasons.map((reason) => (
                  <MeterRow
                    key={reason.errorCode}
                    label={taskErrorLabel(reason.errorCode)}
                    title={reason.errorCode}
                    value={reason.count}
                    total={w.failed}
                    hint={`${reason.count} 个 · ${Math.round((reason.count / w.failed) * 100)}%`}
                    tone="danger"
                  />
                ))}
              </div>
            )}
          </Panel>
        </Fold>
      )}

      <Fold>
        <Panel
          title="收入"
          note={`近 ${days} 天 ¥${yuan(c.gmvWindowCents)} · 累计 ¥${yuan(c.gmvCents)}`}
        >
          <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <Subhead title="收入趋势" note="按支付时间 · 单位：元" />
              <TrendBarChart
                ariaLabel={`近 ${days} 天每日收入`}
                empty="所选窗口内没有支付记录"
                valueFormatter={(value) => `¥${yuan(value, 0)}`}
                items={c.revenueTrend.map((d) => ({
                  key: d.date,
                  date: d.date,
                  value: d.gmvCents,
                  title: `${d.date} · ¥${yuan(d.gmvCents)} · ${d.orders} 单`,
                }))}
              />
            </div>
            <div className="min-w-0">
              <Subhead title="渠道构成" note={`近 ${days} 天 · 按实付金额`} />
              {c.channelMix.length === 0 ? (
                <EmptyInline>所选窗口内没有支付记录</EmptyInline>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {c.channelMix.map((ch) => (
                    <MeterRow
                      key={ch.channel}
                      label={CHANNEL_LABELS[ch.channel] ?? ch.channel}
                      value={ch.gmvCents}
                      total={Math.max(c.gmvWindowCents, 1)}
                      hint={`¥${yuan(ch.gmvCents, 0)} · ${ch.orders} 单`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </Panel>
      </Fold>
    </>
  );
}

/* ── 首屏构件 ────────────────────────────────────────────────────────────── */

/** 队列最多列几条：再多就不叫队列，剩下的去任务页筛 */
const QUEUE_LIMIT = 6;
/** 产出条最多几帧：1440 宽下正好两行 */
const FRAME_LIMIT = 24;

/** 任务通道 → 中文。未登记的原样显示，便于发现新增通道 */
const PROVIDER_LABELS: Record<string, string> = {
  gateway: '真实模型',
  local: '历史本地结果',
  pending: '待执行',
};

/**
 * 首屏以下的折叠区。
 *
 * 与首屏之间隔一段留白；区块本身仍用 `Panel`，但因为与首屏分开，视觉上
 * 不会与「需要动作」的东西混成同一优先级。
 */
function Fold({ children }: { children: ReactNode }) {
  return <div className="mt-1">{children}</div>;
}

/** 小节副标题：标题 + 口径说明 */
function Subhead({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-2.5 flex items-baseline gap-2 text-xs font-semibold text-foreground">
      <span>{title}</span>
      <span className="text-[12px] font-normal text-muted-foreground">{note}</span>
    </div>
  );
}

/** 行内空态：说明「为什么空」，不占整块空间 */
function EmptyInline({ children }: { children: ReactNode }) {
  return <div className="py-6 text-[13px] leading-5 text-muted-foreground">{children}</div>;
}

/** 占比行：失败原因与渠道构成共用一套排版。 */
function MeterRow({
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
    <div className="grid grid-cols-[minmax(96px,160px)_minmax(120px,1fr)_auto] items-center gap-2.5 text-xs">
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
function FailureQueue({ tasks, loading }: { tasks: DutyTask[]; loading: boolean }) {
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
                <span className="overflow-hidden text-[13px] leading-[18px] font-semibold text-ellipsis whitespace-nowrap text-foreground">
                  {/* 状态点先于文字：一列红点让「这是异常」在扫视时成立 */}
                  <span
                    className="mr-1.5 inline-block size-[5px] rounded-full bg-danger-text align-[2px]"
                    aria-hidden
                  />
                  {t.capabilityName}
                </span>
                <span className="overflow-hidden text-[12px] leading-4 text-ellipsis whitespace-nowrap text-muted-foreground">
                  {/* 错误码放在原因前面：排障时先拿码去查日志 */}
                  {t.errorCode ? `${t.errorCode} · ` : ''}
                  {taskErrorLabel(t.errorCode)}
                  {/*
                   * `pending` 是建任务时的初值：失败任务上写「待执行」会与
                   * 同一行的失败原因互相矛盾。
                   */}
                  {t.provider && t.provider !== 'pending'
                    ? ` · ${PROVIDER_LABELS[t.provider] ?? t.provider}`
                    : ''}
                  {` · ${formatDuration(t.durationMs)}`}
                </span>
              </span>
              <span
                className="text-[12px] text-muted-foreground"
                title={new Date(t.createdAt).toLocaleString('zh-CN')}
              >
                {queueTime(t.createdAt)}
              </span>
              <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden />
            </Link>
          </li>
        ))}
      </ol>
      {failures.length > shown.length && (
        <p className="mt-2.5 border-t border-border pt-2.5 text-[12px]">
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
function MachineStats({ tasks }: { tasks: DutyTask[] }) {
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
          className="mb-0.5 overflow-hidden text-[12px] text-ellipsis whitespace-nowrap text-muted-foreground"
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
        <dt className="mb-0.5 overflow-hidden text-[12px] text-ellipsis whitespace-nowrap text-muted-foreground">
          中位耗时
        </dt>
        <dd className="text-base leading-5 font-semibold tracking-tight text-foreground">
          {median === null ? '—' : formatDuration(median)}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="mb-0.5 overflow-hidden text-[12px] text-ellipsis whitespace-nowrap text-muted-foreground">
          样本
        </dt>
        <dd className="text-base leading-5 font-semibold tracking-tight text-foreground">
          {finished.length}
        </dd>
      </div>
    </dl>
  );
}

/** 产出条：最近成功的图，点开就是那条任务的详情 */
function OutputStrip({ tasks }: { tasks: DutyTask[] }) {
  const frames = tasks.filter((t) => t.status === 'succeeded' && t.thumbnailUrl).slice(0, FRAME_LIMIT);

  if (frames.length === 0) {
    return <EmptyInline>最近的任务还没有产出图。</EmptyInline>;
  }

  return (
    <ul className="grid list-none grid-cols-12 gap-1.5">
      {frames.map((t) => (
        <li key={t.id}>
          <Link
            className="group relative block aspect-square overflow-hidden rounded-md border border-border bg-muted focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1"
            to={adminTaskHref(t.id)}
            title={`${t.capabilityName} · ${new Date(t.createdAt).toLocaleString('zh-CN')}`}
            aria-label={`查看产出任务：${t.capabilityName}`}
          >
            <img
              className="block size-full object-cover transition-transform duration-300 group-hover:scale-105"
              src={assetThumbUrl(t.thumbnailUrl, 320)}
              alt=""
              loading="lazy"
            />
            <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-foreground/70 px-1 text-[12px] leading-[15px] text-background opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              {hhmm(t.createdAt)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** 财务待办：最早的几笔待付订单，点开就是订单列表里的同一条 */
function OrderQueue({ orders, loading }: { orders: AdminOrderRow[]; loading: boolean }) {
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
              <span className="overflow-hidden text-[13px] leading-[18px] font-semibold text-ellipsis whitespace-nowrap text-foreground">
                {o.orderNo}
              </span>
              <span className="overflow-hidden text-[12px] leading-4 text-ellipsis whitespace-nowrap text-muted-foreground">
                {o.userEmail}
              </span>
            </span>
            <span className="text-[12.5px] font-semibold text-foreground">
              ¥{yuan(o.totalCents, 0)}
            </span>
            <span
              className="text-[12px] text-muted-foreground"
              title={new Date(o.createdAt).toLocaleString('zh-CN')}
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
function FinanceGrid({ commerce, days }: { commerce: AdminOverview['commerce']; days: number }) {
  const items: Array<{ label: string; value: string; tone?: 'danger' | 'warn' }> = [
    { label: `近 ${days} 天营收`, value: `¥${yuan(commerce.gmvWindowCents)}` },
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
    { label: '有效会员', value: commerce.members.active.toLocaleString('zh-CN') },
    {
      label: `近 ${days} 天积分消耗`,
      value: commerce.credits.consumedInWindow.toLocaleString('zh-CN'),
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="mb-0.5 overflow-hidden text-[12px] text-ellipsis whitespace-nowrap text-muted-foreground">
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

/**
 * 窗口指标带。
 *
 * 一行读数 + 环比，替代六张同权重指标卡：数值与「比上一窗口好还是坏」
 * 挨在一起，扫一眼就有判断。
 */
function WindowStrip({ data, isFinance }: { data: AdminOverview; isFinance: boolean }) {
  const w = data.window;
  const cmp = data.comparison;

  const items: Array<{
    key: string;
    label: string;
    value: string;
    delta: ReactNode;
    hint: string;
    danger?: boolean;
  }> = [
    ...(isFinance
      ? []
      : [
          {
            key: 'tasks',
            label: '任务量',
            value: w.tasks.toLocaleString('zh-CN'),
            delta: <Delta current={w.tasks} previous={cmp.tasks} />,
            hint: `上一窗口 ${cmp.tasks}`,
          },
          {
            key: 'rate',
            label: '成功率',
            value: w.successRate === null ? '—' : `${w.successRate}%`,
            delta: <Delta current={w.successRate} previous={cmp.successRate} unit="pp" />,
            hint: `失败 ${w.failed} 条`,
            danger: w.successRate !== null && w.successRate < 90,
          },
        ]),
    {
      key: 'users',
      label: '新增用户',
      value: w.revenue.usersNew.toLocaleString('zh-CN'),
      delta: <Delta current={w.revenue.usersNew} previous={cmp.usersNew} />,
      hint: `上一窗口 ${cmp.usersNew}`,
    },
    {
      key: 'gmv',
      label: '营收',
      value: `¥${yuan(w.revenue.gmvCents)}`,
      delta: <Delta current={w.revenue.gmvCents} previous={cmp.gmvCents} />,
      hint: `上一窗口 ¥${yuan(cmp.gmvCents, 0)}`,
    },
    {
      key: 'paid',
      label: '支付订单',
      value: w.revenue.paidOrders.toLocaleString('zh-CN'),
      delta: <Delta current={w.revenue.paidOrders} previous={cmp.paidOrders} />,
      hint: `上一窗口 ${cmp.paidOrders}`,
    },
    {
      key: 'refund',
      label: '退款',
      value: `¥${yuan(w.revenue.refundedCents)}`,
      delta: <Delta current={w.revenue.refundedCents} previous={cmp.refundedCents} inverse />,
      hint: `上一窗口 ¥${yuan(cmp.refundedCents, 0)}`,
      danger: w.revenue.refundedCents > 0,
    },
  ];

  return (
    <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-0 gap-y-3.5">
      {items.map((item, index) => (
        <div
          key={item.key}
          className={
            index === 0
              ? 'min-w-0 px-4 pl-0'
              : 'min-w-0 border-l border-border px-4'
          }
        >
          <dt className="mb-1.5 text-[12px] text-muted-foreground">{item.label}</dt>
          <dd className="flex items-baseline gap-1.5">
            <span
              className={
                item.danger
                  ? 'text-xl leading-6 font-semibold tracking-tight text-danger-text'
                  : 'text-xl leading-6 font-semibold tracking-tight text-foreground'
              }
            >
              {item.value}
            </span>
            <span className="text-[12px]">{item.delta}</span>
          </dd>
          <span className="mt-0.5 block text-[12px] text-muted-foreground">{item.hint}</span>
        </div>
      ))}
    </dl>
  );
}

/**
 * 累计规模。
 *
 * `totals` 一直是全量口径，不随页头的时间窗变化；它解决的是「平台现在有
 * 多少用户 / 项目 / 素材」这类存量问题。任务状态与累计成功率只给有任务读权
 * 的运营视角；财务视角用累计实收补位，避免与上方窗口营收混淆。
 */
function TotalsStrip({ data, isFinance }: { data: AdminOverview; isFinance: boolean }) {
  const t = data.totals;
  const items: Array<{
    key: string;
    label: string;
    value: string;
    hint: string;
    danger?: boolean;
  }> = [
    {
      key: 'users',
      label: '用户总数',
      value: t.users.toLocaleString('zh-CN'),
      hint: `近 ${data.days} 天新增 ${t.newUsers.toLocaleString('zh-CN')}`,
    },
    {
      key: 'projects',
      label: '项目总数',
      value: t.projects.toLocaleString('zh-CN'),
      hint: '平台全部项目',
    },
    ...(isFinance
      ? [
          {
            key: 'gmv',
            label: '累计实收',
            value: `¥${yuan(data.commerce.gmvCents)}`,
            hint: `${data.commerce.orders.paid.toLocaleString('zh-CN')} 笔已支付订单`,
          },
        ]
      : [
          {
            key: 'tasks',
            label: '任务总数',
            value: t.tasks.toLocaleString('zh-CN'),
            hint: `运行中 ${t.running.toLocaleString('zh-CN')} · 排队 ${t.queued.toLocaleString('zh-CN')}`,
          },
          {
            key: 'success',
            label: '累计成功率',
            value: t.successRate === null ? '—' : `${t.successRate}%`,
            hint: `成功 ${t.succeeded.toLocaleString('zh-CN')} · 失败 ${t.failed.toLocaleString('zh-CN')}`,
            danger: t.successRate !== null && t.successRate < 90,
          },
        ]),
    {
      key: 'assets',
      label: '素材总量',
      value: t.assets.toLocaleString('zh-CN'),
      hint: `原始 ${t.originals.toLocaleString('zh-CN')} · 生成 ${t.generated.toLocaleString('zh-CN')}`,
    },
  ];

  return (
    <dl
      data-testid="admin-overview-totals"
      className="m-0 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-0 gap-y-3.5"
    >
      {items.map((item, index) => (
        <div
          key={item.key}
          className={index === 0 ? 'min-w-0 px-4 pl-0' : 'min-w-0 border-l border-border px-4'}
        >
          <dt className="mb-1.5 text-[12px] text-muted-foreground">{item.label}</dt>
          <dd
            className={
              item.danger
                ? 'text-xl leading-6 font-semibold tracking-tight text-danger-text tabular-nums'
                : 'text-xl leading-6 font-semibold tracking-tight text-foreground tabular-nums'
            }
          >
            {item.value}
          </dd>
          <span className="mt-0.5 block text-[12px] text-muted-foreground">{item.hint}</span>
        </div>
      ))}
    </dl>
  );
}

/**
 * 队列时刻。
 *
 * 只写 HH:MM 会骗人：队列里的失败可能来自几天前，读起来却像「今天 21:54」。
 * 跨天的行带上月日。
 */
function queueTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = hhmm(iso);
  if (sameDay) return time;
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${time}`;
}

/** 时刻 → HH:MM。后台用 24 小时制，与日志时间对齐 */
function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

/** 支付渠道 → 中文。未登记的原样显示，便于发现新增渠道 */
const CHANNEL_LABELS: Record<string, string> = {
  alipay: '支付宝',
  wechat: '微信支付',
  sandbox: '沙箱',
  unknown: '未记录渠道',
};

/**
 * 环比提示。
 *
 * - `unit="pp"` 用于成功率：两个百分比相减是百分点，不是「增长 x%」
 * - `inverse` 用于退款等「越低越好」的指标，上涨标红
 * - 上一窗口为 0 时不显示 ∞%，改为「新增」或「—」
 */
function Delta({
  current,
  previous,
  unit = 'percent',
  inverse = false,
}: {
  current: number | null;
  previous: number | null;
  unit?: 'percent' | 'pp';
  inverse?: boolean;
}) {
  if (current === null || previous === null) {
    return <span className="font-medium text-muted-foreground tabular-nums">—</span>;
  }
  if (previous === 0) {
    return current === 0 ? (
      <span className="font-medium text-muted-foreground tabular-nums">持平</span>
    ) : (
      <span
        className={
          inverse
            ? 'font-medium text-danger-text tabular-nums'
            : 'font-medium text-success-text tabular-nums'
        }
      >
        {current > 0 ? '新增' : '—'}
      </span>
    );
  }

  const diff = unit === 'pp' ? current - previous : ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(diff) < 0.05) {
    return <span className="font-medium text-muted-foreground tabular-nums">持平</span>;
  }

  const up = diff > 0;
  const good = inverse ? !up : up;
  return (
    <span
      className={
        good
          ? 'font-medium text-success-text tabular-nums'
          : 'font-medium text-danger-text tabular-nums'
      }
    >
      {up ? '↑' : '↓'}
      {unit === 'pp' ? `${Math.abs(diff).toFixed(1)}pp` : `${Math.abs(diff).toFixed(0)}%`}
    </span>
  );
}

/**
 * 分 → 元。
 *
 * 后端金额一律整数分，展示时才换算 —— 不在接口层做格式化，避免「接口给元、
 * 某处又乘 100」的口径漂移。
 *
 * @param digits 小数位。柱状图上的数字用 0 位，否则刻度会挤成一片
 */
function yuan(cents: number, digits = 2): string {
  return (cents / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * 通用加载态：标题占位 + 内容占位，加载期间不闪白。
 *
 * 用在**还知道自己在加载哪一页**之前的两处：路由 chunk 的 Suspense 兜底、
 * 以及后台身份校验期间的骨架。这两处都不知道页面标题，所以标题只能是灰条；
 * 等页面自己渲染后，它会换成真实标题（见各页的 `PageSkeleton`）。
 */
function AdminLoading({ tip }: { tip: string }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <div>
        <Skeleton rows={1} className="max-w-[260px]" />
        <p className="mt-2 text-xs text-muted-foreground">{tip}</p>
      </div>
      <Skeleton rows={6} />
    </div>
  );
}

/**
 * 后台内容区域。
 *
 * 本身不包外壳 —— 布局由 `AdminShell` 提供，这样 `/admin/*` 下的所有子路由
 * 都能复用同一个外壳，而不必各自再包一层。
 */
export function AdminDashboardContent() {
  return <DashboardContent />;
}

/**
 * 后台路由守卫 + 外壳 + 子路由。
 *
 * 决策链：
 *   无 token        → /login
 *   身份加载中      → 骨架（不发请求）
 *   非后台角色      → 拒绝页（前端可绕过，后端仍会拦）
 *   通过            → AdminBoardLayout + 子路由
 *
 * 不用 Navigate 静默弹回：C 端用户访问 /admin 时静默跳 /workbench，用户只会
 * 看到「莫名其妙回到工作台」，不知道是权限问题还是页面坏了。
 */
export function AdminShell() {
  const { token, email } = useAuth();
  const { me, loading, error, errorStatus, refresh } = useAdmin();
  const location = useLocation();

  if (!token) return <Navigate to="/login" replace />;
  if (loading) return <NoAdminShellLoading />;
  if (!me) {
    /*
     * 不能只看 `!me`。断网或后端 5xx 时 `/admin/me` 失败 → me 为空 → 整页渲染
     * 「需要后台权限」，把一次网络故障说成权限问题。只有 401/403 才是真的没
     * 权限；其余一律按「后台连不上」处理并给重试。
     */
    const denied = errorStatus === 401 || errorStatus === 403;
    if (error && !denied) return <AdminLoadError message={error} onRetry={refresh} />;
    return <NoAdminAccess email={email} />;
  }

  return (
    <AdminUIProvider>
      <AdminBoardLayout>
        <ErrorBoundary resetKeys={[location.pathname]}>
          <Suspense fallback={<AdminLoading tip="加载页面…" />}>
            <Routes>
              {/*
               * 值班数据只服务概览：Provider 包在这一条路由上，切到别的页面即
               * 卸载，30 秒轮询随之停止。
               */}
              <Route
                index
                element={
                  <AdminDutyProvider>
                    <DashboardContent />
                  </AdminDutyProvider>
                }
              />
              <Route path="alerts" element={<AdminAlertsPage />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="roles" element={<AdminRolesPage />} />
              <Route path="settings" element={<AdminSettingsPage />} />
              <Route path="audit-logs" element={<AdminAuditPage />} />
              <Route path="backups" element={<AdminBackupPage />} />
              <Route path="assets" element={<AdminAssetsPage />} />
              <Route path="storage" element={<AdminStoragePage />} />
              <Route path="coupons" element={<AdminCouponsPage />} />
              <Route path="campaigns" element={<AdminCampaignsPage />} />
              <Route path="marketing-rules" element={<AdminMarketingRulesPage />} />
              <Route path="scheduler" element={<AdminSchedulerPage />} />
              {/* 模型层：渠道 → 前台模型 → 分组 → 插件 → 账单 */}
              <Route path="channels" element={<AdminChannelsPage />} />
              <Route path="logical-models" element={<AdminLogicalModelsPage />} />
              <Route path="user-groups" element={<AdminUserGroupsPage />} />
              <Route path="plugins" element={<AdminPluginsPage />} />
              <Route path="billing-orders" element={<AdminBillingOrdersPage />} />
              <Route path="finance" element={<AdminFinancePage />} />
              <Route path="model-calls" element={<AdminModelCallsPage />} />
              {/* 能力管控：单项能力上下线 */}
              <Route path="capabilities" element={<AdminCapabilitiesPage />} />
              {/* 任务监控 */}
              <Route path="tasks" element={<AdminTasksPage />} />
              {/* 工单处理：客服队列，与任务监控同组 */}
              <Route path="tickets" element={<AdminTicketsPage />} />
              {/* 能力消耗价 */}
              <Route path="credit-prices" element={<AdminCreditPricesPage />} />
              {/* 交易后台：商品 / 订单 / 积分账本 / 保留期清理 */}
              <Route path="products" element={<AdminProductsPage />} />
              <Route path="membership-plans" element={<AdminMembershipPlansPage />} />
              <Route path="orders" element={<AdminOrdersPage />} />
              <Route path="credits" element={<AdminCreditsPage />} />
              <Route path="retention" element={<AdminRetentionPage />} />
              {/* 财务：支付充值（四标签）/ 发票审核 */}
              <Route path="payments" element={<AdminPaymentsPage />} />
              <Route path="invoices" element={<AdminInvoicesPage />} />
              {/*
               * 旧路由重定向到新页面的对应标签。
               *
               * 后端支付域重构后旧控制器已删除，旧页面必然报错；旧书签与
               * 告警深链还在用这两个路径，重定向比 404 友好 —— 直接把用户
               * 送到对应标签，而不是让他们自己找。
               */}
              <Route
                path="payment-channels"
                element={<Navigate to="/admin/payments?tab=providers" replace />}
              />
              <Route
                path="reconciliation"
                element={<Navigate to="/admin/payments?tab=reconciliation" replace />}
              />
              <Route path="legal" element={<AdminLegalPage />} />
              <Route path="notifications" element={<AdminNotificationsPage />} />
              {/* AI 标识样式 */}
              <Route path="aigc-label" element={<AdminAigcLabelPage />} />
              {/* 未实现的模块：显式提示而非静默跳回概览 */}
              <Route path="*" element={<NotImplementedPage />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </AdminBoardLayout>
    </AdminUIProvider>
  );
}

/**
 * 身份校验期间的骨架。
 *
 * 外壳还没挂载，不能复用页面内的 `AdminLoading` —— 这里画一个与外壳同构的
 * 占位（左侧栏 + 内容区），让加载到渲染之间不发生布局跳动。
 */
function NoAdminShellLoading() {
  return (
    <div className="admin-root flex min-h-screen bg-page" aria-busy="true" aria-live="polite">
      <div className="w-[232px] shrink-0 border-r border-border bg-card" aria-hidden />
      <div className="min-w-0 flex-1 px-[26px] pt-[18px]">
        <AdminLoading tip="校验后台权限…" />
      </div>
    </div>
  );
}

/** 后台身份接口失败（非权限原因）时的显式失败态 —— 提供重试，不误导成权限问题 */
function AdminLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="admin-root flex min-h-screen items-center justify-center bg-page p-6">
      <div className="w-full max-w-[560px] rounded-lg border border-border bg-card p-8 shadow-card">
        <h1 className="mb-2 text-xl font-semibold text-foreground">后台暂时连不上</h1>
        <p className="mb-5 text-sm text-muted-foreground">
          没能取到后台身份信息。这通常是网络中断或服务暂时不可用，与账号权限无关。
        </p>
        <div className="mb-6 rounded-lg bg-muted px-3.5 py-3 text-[13px] text-muted-foreground">
          <strong className="mb-1.5 block text-[13px] text-foreground">错误信息</strong>
          <ul className="m-0 list-disc pl-[18px]">
            <li className="my-0.5">{message}</li>
          </ul>
        </div>
        <ActionButton variant="default" onClick={onRetry}>
          重新连接
        </ActionButton>
      </div>
    </div>
  );
}

/**
 * 无后台权限页。
 *
 * 常见误入原因（按可能性排序），逐条给出以便自查：
 *   1. 用 C 端账号登录 —— 普通注册用户默认没有后台角色
 *   2. 账号被降权 —— 后台立即生效，旧 token 下次请求即 403
 *   3. 账号被禁用
 */
function NoAdminAccess({ email }: { email: string | null }) {
  const navigate = useNavigate();
  const { logout } = useAuth();

  return (
    <div className="admin-root flex min-h-screen items-center justify-center bg-page p-6">
      <div className="w-full max-w-[560px] rounded-lg border border-border bg-card p-8 shadow-card">
        <h1 className="mb-2 text-xl font-semibold text-foreground">需要后台权限</h1>
        <p className="mb-5 text-sm text-muted-foreground">
          当前账号 <strong className="text-foreground">{email ?? '(未登录)'}</strong>{' '}
          没有运营后台的访问权限。
        </p>

        <div className="mb-4 rounded-lg bg-muted px-3.5 py-3 text-[13px] text-muted-foreground">
          <strong className="mb-1.5 block text-[13px] text-foreground">可能原因</strong>
          <ul className="m-0 list-disc pl-[18px]">
            <li className="my-0.5">使用了 C 端账号登录 —— 普通注册用户默认没有后台角色</li>
            <li className="my-0.5">账号的角色已被降权，后台权限立即生效</li>
            <li className="my-0.5">账号已被禁用</li>
          </ul>
        </div>
        <div className="mb-6 rounded-lg bg-muted px-3.5 py-3 text-[13px] text-muted-foreground">
          <strong className="mb-1.5 block text-[13px] text-foreground">如何进入</strong>
          <ul className="m-0 list-disc pl-[18px]">
            <li className="my-0.5">
              退出后用运营账号登录：development / test 启动时会自动创建预设管理员；production
              运行{' '}
              <code className="rounded border border-border bg-card px-1 py-0.5 font-mono">
                npm run seed:admin
              </code>{' '}
              生成一次性随机密码
            </li>
            <li className="my-0.5">
              已有管理员账号但不知密码：用该账号在「用户管理 → 重置密码」获取临时密码
            </li>
          </ul>
        </div>

        <div className="flex gap-2">
          <ActionButton variant="secondary" onClick={() => navigate('/workbench')}>
            返回工作台
          </ActionButton>
          <ActionButton
            variant="default"
            onClick={() => {
              logout();
              navigate('/login');
            }}
          >
            换个账号登录
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

/**
 * 占位页：让「待建」菜单项点了有明确反馈，而不是看起来像坏了。
 *
 * catch-all 同时接住了「纯打错的 URL」（如 /admin/uesrs）。比对侧栏菜单：
 * 命中 planned 项 → 说「尚未开放」；未命中任何菜单项 → 如实说「页面不存在」。
 */
function NotImplementedPage() {
  const location = useLocation();
  const hit = findAdminMenuItem(location.pathname);

  if (!hit?.planned) {
    return (
      <ExceptionPage
        kind="not-found"
        title="页面不存在"
        desc={`后台没有 ${location.pathname} 这个页面，可能是地址输入有误，或该功能已调整。`}
        detail={`unmatched admin path: ${location.pathname}`}
        action={{ to: '/admin', label: '返回平台概览' }}
        showBack={false}
      />
    );
  }

  return (
    <ExceptionPage
      kind="info"
      title={`${hit.label} 尚未开放`}
      desc="该模块已在后台菜单中占位，计划在后续批次交付。可以先回平台概览，或查看其他已可用的模块。"
      action={{ to: '/admin', label: '返回平台概览' }}
      showBack={false}
    />
  );
}
