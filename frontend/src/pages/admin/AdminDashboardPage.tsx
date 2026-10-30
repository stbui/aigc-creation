import { lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react';
import { Button, Segmented } from 'antd';
import { Navigate, Route, Routes, useLocation, useNavigate, Link } from 'react-router-dom';
import { adminApi } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useAdmin } from '../../context/AdminContext';
import { ChevronRight } from 'lucide-react';
import { AdminLayout, AdminPageLoading, findAdminMenuItem } from '../../components/admin/AdminLayout';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { ExceptionPage } from '../../components/ExceptionPage';
import { PageHeader } from '../../components/admin/PageHeader';
import { AdminStaleError, useAdminResource } from '../../components/admin/AdminWidgets';
import { DutyChannelTower, duration, earliestFailure } from '../../components/admin/DutyBand';
import { useDuty, type DutyTask } from '../../components/admin/DutyContext';
import { toAbsoluteUrl } from '../../lib/api';
import { taskErrorLabel } from '../../lib/admin-error-codes';
import { adminOrderDetailHref, adminTaskHref } from '../../lib/admin-links';
import type { AdminOrderRow, AdminOverview } from '../../types/api';

/**
 * 后台子路由按页加载。
 *
 * `/admin` 外壳本身已经是懒加载，但此前外壳一次性静态导入全部 28 个页面，
 * 进入概览时仍要下载整包后台代码。这里保留外壳与概览同步加载，其余页面
 * 在首次导航到对应路由时再请求各自 chunk；Suspense 放在 AdminLayout 内，
 * 加载期间顶栏与侧栏不消失，避免整屏闪白。
 */
function lazyAdminPage<T extends Record<string, ComponentType<any>>>(
  loader: () => Promise<T>,
  name: keyof T & string,
) {
  return lazy(() => loader().then((m) => ({ default: m[name] })));
}

const AdminUsersPage = lazyAdminPage(() => import('./AdminUsersPage'), 'AdminUsersPage');
const AdminRolesPage = lazyAdminPage(() => import('./AdminRolesPage'), 'AdminRolesPage');
const AdminSettingsPage = lazyAdminPage(() => import('./AdminSettingsPage'), 'AdminSettingsPage');
const AdminAuditPage = lazyAdminPage(() => import('./AdminAuditPage'), 'AdminAuditPage');
const AdminBackupPage = lazyAdminPage(() => import('./AdminBackupPage'), 'AdminBackupPage');
const AdminAssetsPage = lazyAdminPage(() => import('./AdminAssetsPage'), 'AdminAssetsPage');
const AdminStoragePage = lazyAdminPage(() => import('./AdminStoragePage'), 'AdminStoragePage');
const AdminCouponsPage = lazyAdminPage(() => import('./AdminCouponsPage'), 'AdminCouponsPage');
const AdminCampaignsPage = lazyAdminPage(
  () => import('./AdminCampaignsPage'),
  'AdminCampaignsPage',
);
const AdminMarketingRulesPage = lazyAdminPage(
  () => import('./AdminMarketingRulesPage'),
  'AdminMarketingRulesPage',
);
const AdminSchedulerPage = lazyAdminPage(
  () => import('./AdminSchedulerPage'),
  'AdminSchedulerPage',
);
const AdminModelConfigPage = lazyAdminPage(
  () => import('./AdminModelConfigPage'),
  'AdminModelConfigPage',
);
const AdminModelCallsPage = lazyAdminPage(
  () => import('./AdminModelCallsPage'),
  'AdminModelCallsPage',
);
const AdminCapabilitiesPage = lazyAdminPage(
  () => import('./AdminCapabilitiesPage'),
  'AdminCapabilitiesPage',
);
const AdminTasksPage = lazyAdminPage(() => import('./AdminTasksPage'), 'AdminTasksPage');
const AdminTicketsPage = lazyAdminPage(() => import('./AdminTicketsPage'), 'AdminTicketsPage');
const AdminCreditPricesPage = lazyAdminPage(
  () => import('./AdminCreditPricesPage'),
  'AdminCreditPricesPage',
);
const AdminProductsPage = lazyAdminPage(() => import('./AdminProductsPage'), 'AdminProductsPage');
const AdminOrdersPage = lazyAdminPage(() => import('./AdminOrdersPage'), 'AdminOrdersPage');
const AdminCreditsPage = lazyAdminPage(() => import('./AdminCreditsPage'), 'AdminCreditsPage');
const AdminRetentionPage = lazyAdminPage(
  () => import('./AdminRetentionPage'),
  'AdminRetentionPage',
);
const AdminInvoicesPage = lazyAdminPage(() => import('./AdminInvoicesPage'), 'AdminInvoicesPage');
const AdminPaymentChannelsPage = lazyAdminPage(
  () => import('./AdminPaymentChannelsPage'),
  'AdminPaymentChannelsPage',
);
const AdminReconciliationPage = lazyAdminPage(
  () => import('./AdminReconciliationPage'),
  'AdminReconciliationPage',
);
const AdminLegalPage = lazyAdminPage(() => import('./AdminLegalPage'), 'AdminLegalPage');
const AdminNotificationsPage = lazyAdminPage(
  () => import('./AdminNotificationsPage'),
  'AdminNotificationsPage',
);
const AdminAigcLabelPage = lazyAdminPage(
  () => import('./AdminAigcLabelPage'),
  'AdminAigcLabelPage',
);
const AdminAlertsPage = lazyAdminPage(() => import('./AdminAlertsPage'), 'AdminAlertsPage');

/**
 * 平台概览（值班台）。
 *
 * ## 首屏只回答三件事
 *
 * 有什么坏了（异常队列）→ 机器还在不在转（机器状态）→ 最近产出了什么
 * （产出条）。此前首屏是十几张同权重的指标卡，异常淹没在正常里；现在
 * 只有「需要动作」的东西占据第一屏，累计指标下沉到带分隔线的区块。
 *
 * ## 与值班带同源
 *
 * 带子（外壳里的 128px 深色仪表带）与这里的队列读同一份 DutyContext 快照，
 * 不会出现「带子里 6 条异常、队列里 5 条」。财务没有 task.read：队列换成
 * 待付订单，机器状态换成交易指标，不请求任务接口。
 */
function DashboardContent() {
  const [days, setDays] = useState<number>(7);
  /*
   * 切换时间窗与「重试」都走同一份资源: 换窗口时旧数据留在屏幕上直到新数据到位,
   * 不再整页塌成骨架屏 —— 概览页塌一次, 用户会以为刚看到的数字丢了。
   */
  const { data, loading, error, reload } = useAdminResource(
    () => adminApi.overview(days),
    [days],
  );
  const { data: duty } = useDuty();
  const { can } = useAdmin();
  /* 财务没有任务读权: 队列、产出条、任务趋势整体换成交易视角 */
  const isFinance = !can('task.read');

  // 首屏骨架: 只有完全没有数据时才塌整页
  if (loading && !data) return <AdminPageLoading tip="加载统计数据…" />;
  if (error && !data) {
    return (
      <ExceptionPage
        kind="warning"
        title="统计数据加载失败"
        desc="概览数据未能加载，下方是后端返回的原因。确认服务可用后重试即可，不会影响已产生的任何数据。"
        detail={error}
        action={
          <Button type="primary" onClick={() => void reload()}>
            重试
          </Button>
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
   * 74 条快照里的全部失败。把最早那条的时刻写到标题旁，读的人不用自己
   * 去对「带子说 0、队列有 4 条」这件事。
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
            <Segmented
              value={days}
              onChange={(value) => setDays(Number(value))}
              options={[7, 30, 90].map((value) => ({ value, label: `近 ${value} 天` }))}
            />
            <Button loading={loading} onClick={() => void reload()}>
              刷新
            </Button>
          </>
        }
      />

      {/* 换时间窗失败时保留上一窗口的数字, 但要明说这是旧的, 否则用户会拿过期数据做判断 */}
      {error && <AdminStaleError error={error} onRetry={() => void reload()} />}

      {/*
       * 首屏双栏: 左 62% 给需要动作的队列, 右 38% 给机器状态。
       * 不等分 —— 队列是「要做的事」, 通道是「要确认的环境」, 前者优先。
       */}
      <div className="adm-deck">
        {isFinance ? (
          <Block
            title="待办队列"
            note={duty ? `最早 ${duty.orders.length} 笔待付 · 按创建时间` : '读取中…'}
            action={
              <Link className="adm-block-link" to="/admin/orders?status=pending">
                全部待付订单
              </Link>
            }
          >
            <OrderQueue orders={duty?.orders ?? []} loading={!duty} />
          </Block>
        ) : (
          <Block
            title="异常队列"
            note={
              duty
                ? `最近 ${tasks.length} 条任务中的失败${
                    firstFailure ? ` · 最早 ${queueTime(firstFailure.createdAt)}` : ' · 无'
                  }`
                : '读取中…'
            }
            action={
              <Link className="adm-block-link" to="/admin/tasks?status=failed">
                全部失败任务
              </Link>
            }
          >
            <FailureQueue tasks={tasks} loading={!duty} />
          </Block>
        )}

        <Block
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
          action={
            !isFinance && can('model.config_read') ? (
              <Link className="adm-block-link" to="/admin/model-config">
                模型配置
              </Link>
            ) : undefined
          }
        >
          {isFinance ? (
            <FinanceGrid commerce={c} days={days} />
          ) : (
            <div className="adm-machine">
              <DutyChannelTower limit={4} />
              <MachineStats tasks={tasks} />
            </div>
          )}
        </Block>
      </div>

      {/*
       * 窗口表现：与首屏的实时读数分开。
       * 「任务总量 / 成功率」是历史累计，运营真正要看的是「最近这一档在变好
       * 还是变坏」，所以环比用紧邻的等长窗口做分母。
       */}
      <div className="adm-fold">
        <Block title={`近 ${days} 天`} note={`对比上一个 ${days} 天`}>
          <WindowStrip data={data} isFinance={isFinance} />
        </Block>
      </div>

      {!isFinance && (
        <div className="adm-fold">
          <Block
            title="最近产出"
            note={`最近 ${tasks.length} 条任务里的成功产出 · 最多 ${FRAME_LIMIT} 张`}
            action={
              <Link className="adm-block-link" to="/admin/tasks">
                前往任务监控
              </Link>
            }
          >
            <OutputStrip tasks={tasks} />
          </Block>
        </div>
      )}

      {!isFinance && (
        <div className="adm-fold">
          <Block title="任务趋势" note={`近 ${days} 天 · 有失败的日子标红`}>
            <TrendChart
              ariaLabel={`近 ${days} 天每日任务量`}
              empty="所选窗口内没有任务记录"
              items={data.trend.map((d) => ({
                key: d.date,
                date: d.date,
                value: d.total,
                text: String(d.total),
                title: `${d.date} · ${d.total} 个任务 · 失败 ${d.failed}`,
                warn: d.failed > 0,
              }))}
            />
          </Block>
        </div>
      )}

      {!isFinance && (
        <div className="adm-fold">
          <Block
            title="失败原因"
            note={w.failed > 0 ? `近 ${days} 天共 ${w.failed} 条失败` : `近 ${days} 天没有失败任务`}
            action={
              w.failed > 0 ? (
                <Link className="adm-block-link" to="/admin/tasks?status=failed">
                  查看失败任务
                </Link>
              ) : undefined
            }
          >
            {w.failed === 0 ? (
              <div className="adm-empty-inline is-ok">近 {days} 天没有失败任务</div>
            ) : (
              <div className="adm-mix-list">
                {w.failureReasons.map((reason) => (
                  <div key={reason.errorCode} className="adm-mix-row">
                    <span className="adm-mix-label" title={reason.errorCode}>
                      {taskErrorLabel(reason.errorCode)}
                    </span>
                    <span className="adm-mix-track" aria-hidden="true">
                      <span
                        className="adm-mix-fill is-danger"
                        style={{ width: `${Math.max((reason.count / w.failed) * 100, 2)}%` }}
                      />
                    </span>
                    <span className="adm-mix-value">
                      {reason.count} 个 · {Math.round((reason.count / w.failed) * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Block>
        </div>
      )}

      <div className="adm-fold">
        <Block
          title="收入"
          note={`近 ${days} 天 ¥${yuan(c.gmvWindowCents)} · 累计 ¥${yuan(c.gmvCents)}`}
        >
          <div className="adm-split">
            <div className="adm-split-col">
              <div className="adm-subhead">
                收入趋势<span>按支付时间 · 单位: 元</span>
              </div>
              <TrendChart
                ariaLabel={`近 ${days} 天每日收入`}
                empty="所选窗口内没有支付记录"
                items={c.revenueTrend.map((d) => ({
                  key: d.date,
                  date: d.date,
                  value: d.gmvCents,
                  text: yuan(d.gmvCents, 0),
                  title: `${d.date} · ¥${yuan(d.gmvCents)} · ${d.orders} 单`,
                }))}
              />
            </div>
            <div className="adm-split-col">
              <div className="adm-subhead">
                渠道构成<span>近 {days} 天 · 按实付金额</span>
              </div>
              {c.channelMix.length === 0 ? (
                <div className="adm-empty-inline">所选窗口内没有支付记录</div>
              ) : (
                <div className="adm-mix-list">
                  {c.channelMix.map((ch) => (
                    <div key={ch.channel} className="adm-mix-row">
                      <span className="adm-mix-label">
                        {CHANNEL_LABELS[ch.channel] ?? ch.channel}
                      </span>
                      <span className="adm-mix-track" aria-hidden="true">
                        <span
                          className="adm-mix-fill"
                          style={{
                            width: `${Math.max((ch.gmvCents / Math.max(c.gmvWindowCents, 1)) * 100, 2)}%`,
                          }}
                        />
                      </span>
                      <span className="adm-mix-value">
                        ¥{yuan(ch.gmvCents, 0)} · {ch.orders} 单
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Block>
      </div>
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
 * 区块：一行标题 + 说明 + 右侧入口。
 *
 * 不画卡片：区块之间只隔一条发丝线，页面读起来是一张工作表而不是一堆盒子。
 */
function Block({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="adm-block">
      <header className="adm-block-head">
        <h2 className="adm-block-title">{title}</h2>
        {note && <span className="adm-block-note">{note}</span>}
        {action && <span className="adm-block-action">{action}</span>}
      </header>
      {children}
    </section>
  );
}

/**
 * 异常队列。
 *
 * 最早的在最上面：值班带的主按钮「接手最早异常」跳到的那条，就是这里的
 * 第一行 —— 带子与队列指向同一条任务，人不需要再找一次。
 */
function FailureQueue({ tasks, loading }: { tasks: DutyTask[]; loading: boolean }) {
  const failures = tasks
    .filter((t) => t.status === 'failed')
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const shown = failures.slice(0, QUEUE_LIMIT);

  if (loading && tasks.length === 0) {
    return <div className="adm-empty-inline">读取任务快照…</div>;
  }
  if (shown.length === 0) {
    return (
      <div className="adm-empty-inline is-ok">
        最近 {tasks.length} 条任务没有失败 —— 暂时没有需要接手的异常。
      </div>
    );
  }

  return (
    <>
      <ol className="adm-queue">
        {shown.map((t, i) => (
          <li key={t.id}>
            <Link className="adm-queue-row" to={adminTaskHref(t.id)}>
              <span className="adm-queue-seq">{String(i + 1).padStart(2, '0')}</span>
              <span className="adm-queue-main">
                <span className="adm-queue-title">
                  {/* 状态点先于文字：一列红点让「这是异常」在扫视时成立 */}
                  <span className="adm-status-dot is-danger" aria-hidden="true" />
                  {t.capabilityName}
                </span>
                <span className="adm-queue-sub">
                  {/* 错误码放在原因前面：排障时先拿码去查日志 */}
                  {t.errorCode ? `${t.errorCode} · ` : ''}
                  {taskErrorLabel(t.errorCode)}
                  {/*
                   * `pending` 是建任务时的初值：失败任务上写「待执行」会与
                   * 同一行的失败原因互相矛盾，与任务列表列的处理保持一致。
                   */}
                  {t.provider && t.provider !== 'pending'
                    ? ` · ${PROVIDER_LABELS[t.provider] ?? t.provider}`
                    : ''}
                  {` · ${duration(t.durationMs)}`}
                </span>
              </span>
              <span className="adm-queue-time" title={new Date(t.createdAt).toLocaleString('zh-CN')}>
                {queueTime(t.createdAt)}
              </span>
              <ChevronRight className="adm-queue-arrow" size={14} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ol>
      {failures.length > shown.length && (
        <p className="adm-queue-more">
          <Link className="adm-block-link" to="/admin/tasks?status=failed">
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
    <dl className="adm-machine-stats">
      <div>
        {/* 「近期」是要紧的限定：下面还有一条近 N 天的成功率，不区分会被读成打架 */}
        <dt title={`最近 ${tasks.length} 条任务中的已结算项`}>近期成功率</dt>
        <dd className={rate !== null && rate < 90 ? 'is-danger' : undefined}>
          {rate === null ? '—' : `${rate}%`}
        </dd>
      </div>
      <div>
        <dt>中位耗时</dt>
        <dd>{median === null ? '—' : duration(median)}</dd>
      </div>
      <div>
        <dt>样本</dt>
        <dd>{finished.length}</dd>
      </div>
    </dl>
  );
}

/** 产出条：最近成功的图，点开就是那条任务的详情抽屉 */
function OutputStrip({ tasks }: { tasks: DutyTask[] }) {
  const frames = tasks
    .filter((t) => t.status === 'succeeded' && t.thumbnailUrl)
    .slice(0, FRAME_LIMIT);

  if (frames.length === 0) {
    return <div className="adm-empty-inline">最近的任务还没有产出图。</div>;
  }

  return (
    <ul className="adm-frames">
      {frames.map((t) => (
        <li key={t.id}>
          <Link
            className="adm-frame"
            to={adminTaskHref(t.id)}
            title={`${t.capabilityName} · ${new Date(t.createdAt).toLocaleString('zh-CN')}`}
            aria-label={`查看产出任务：${t.capabilityName}`}
          >
            <img src={toAbsoluteUrl(t.thumbnailUrl!)} alt="" loading="lazy" />
            <span className="adm-frame-time">{hhmm(t.createdAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** 财务待办：最早的几笔待付订单，点开就是订单列表里的同一条 */
function OrderQueue({ orders, loading }: { orders: AdminOrderRow[]; loading: boolean }) {
  if (loading) return <div className="adm-empty-inline">读取订单…</div>;
  if (orders.length === 0) return <div className="adm-empty-inline is-ok">没有待支付订单。</div>;

  return (
    <ol className="adm-queue">
      {orders.map((o, i) => (
        <li key={o.id}>
          <Link className="adm-queue-row" to={adminOrderDetailHref(o.id)}>
            <span className="adm-queue-seq">{String(i + 1).padStart(2, '0')}</span>
            <span className="adm-queue-main">
              <span className="adm-queue-title">{o.orderNo}</span>
              <span className="adm-queue-sub">{o.userEmail}</span>
            </span>
            <span className="adm-queue-amount">¥{yuan(o.totalCents, 0)}</span>
            <span className="adm-queue-time" title={new Date(o.createdAt).toLocaleString('zh-CN')}>
              {hhmm(o.createdAt)}
            </span>
            <ChevronRight className="adm-queue-arrow" size={14} aria-hidden="true" />
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
    <dl className="adm-machine-stats is-grid">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd className={item.tone ? `is-${item.tone}` : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * 窗口指标带。
 *
 * 一行读数 + 环比，替代原来的六张指标卡：数值与「比上一窗口好还是坏」
 * 挨在一起，扫一眼就有判断，不必在卡片之间来回比对。
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
    <dl className="adm-metrics">
      {items.map((item) => (
        <div key={item.key} className={`adm-metric${item.danger ? ' is-danger' : ''}`}>
          <dt>{item.label}</dt>
          <dd>
            <span className="adm-metric-value">{item.value}</span>
            <span className="adm-metric-delta">{item.delta}</span>
          </dd>
          <span className="adm-metric-hint">{item.hint}</span>
        </div>
      ))}
    </dl>
  );
}

/**
 * 柱状趋势。
 *
 * 网格线给柱子一个基准，否则高度无从判断；有失败的日子整根柱子转警示色 ——
 * 趋势图不能只展示成功的一面。
 */
function TrendChart({
  items,
  empty,
  ariaLabel,
}: {
  items: Array<{ key: string; date: string; value: number; text: string; title: string; warn?: boolean }>;
  empty: string;
  ariaLabel: string;
}) {
  if (items.every((i) => i.value === 0)) {
    return <div className="adm-empty-inline">{empty}</div>;
  }
  const peak = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="adm-trend" role="img" aria-label={ariaLabel}>
      <div className="adm-trend-grid" aria-hidden="true">
        {[100, 75, 50, 25, 0].map((p) => (
          <div key={p} className="adm-trend-gridline" style={{ bottom: `${p}%` }} />
        ))}
      </div>
      {items.map((d) => {
        const h = Math.round((d.value / peak) * 100);
        return (
          <div key={d.key} className="adm-trend-col">
            <div className="adm-trend-bar-wrap">
              <div
                className={`adm-trend-bar${d.warn ? ' has-failed' : ''}`}
                style={{ height: `${Math.max(h, d.value > 0 ? 3 : 0)}%` }}
                title={d.title}
              >
                {d.value > 0 && <span className="adm-trend-value">{d.text}</span>}
              </div>
            </div>
            <div className="adm-trend-label">{d.date.slice(5).replace('-', '/')}</div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 队列时刻。
 *
 * 只写 HH:MM 会骗人：队列里的失败可能来自几天前，读起来却像「今天 21:54」，
 * 甚至晚于页头的「截至时刻」。跨天的行带上月日。
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
    return <span className="adm-delta is-flat">—</span>;
  }
  if (previous === 0) {
    return current === 0 ? (
      <span className="adm-delta is-flat">持平</span>
    ) : (
      <span className={`adm-delta ${inverse ? 'is-bad' : 'is-good'}`}>
        {current > 0 ? '新增' : '—'}
      </span>
    );
  }

  const diff = unit === 'pp' ? current - previous : ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(diff) < 0.05) return <span className="adm-delta is-flat">持平</span>;

  const up = diff > 0;
  const good = inverse ? !up : up;
  return (
    <span className={`adm-delta ${good ? 'is-good' : 'is-bad'}`}>
      {up ? '↑' : '↓'}
      {unit === 'pp' ? `${Math.abs(diff).toFixed(1)}pp` : `${Math.abs(diff).toFixed(0)}%`}
    </span>
  );
}

/**
 * 分 → 元。
 *
 * 后端金额一律整数分, 展示时才换算 —— 不在接口层做格式化,
 * 避免"接口给元、某处又乘 100"的口径漂移。
 *
 * @param digits 小数位。柱状图上的数字用 0 位, 否则柱子会挤成一片
 */
function yuan(cents: number, digits = 2): string {
  return (cents / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * 后台内容区域。
 *
 * ⚠ 本身不包 AdminLayout —— 布局由 AdminShell 提供, 这样 /admin/* 下的
 * 所有子路由都能复用同一个外壳, 而不必各自再包一层。
 */
export function AdminDashboardContent() {
  return <DashboardContent />;
}

/**
 * 后台路由守卫 + 外壳 + 子路由。
 *
 * 决策链:
 *   无 token        → /login
 *   身份加载中      → 骨架 (不发请求)
 *   非后台角色      → 拒绝页 (前端可绕过, 后端仍会拦)
 *   通过            → AdminLayout + 子路由
 *
 *⚠ 为什么不用 Navigate 静默弹回:
 *   C端用户访问 /admin 时静默跳 /workbench, 用户只会看到「莫名其妙回到工作台」,
 *   不知道是权限问题还是页面坏了。这里显式说明原因并给出下一步。
 */
export function AdminShell() {
  const { token, email } = useAuth();
  const { me, loading, error, errorStatus, refresh } = useAdmin();
  const location = useLocation();

  if (!token) return <Navigate to="/login" replace />;
  if (loading) return <AdminPageLoading tip="校验后台权限…" />;
  if (!me) {
    /*
     * ⚠ 2026-10-22: 不能只看 `!me`。
     *
     * 之前断网或后端 5xx 时 `/admin/me` 失败 → me 为空 → 整页渲染
     * 「需要后台权限」并建议「去重置密码」，把一次网络故障说成权限问题，
     * 用户既解决不了问题，还会做一次无谓的密码变更。
     * 只有 401/403 才是真的没权限；其余一律按「后台连不上」处理并给重试。
     */
    const denied = errorStatus === 401 || errorStatus === 403;
    if (error && !denied) return <AdminLoadError message={error} onRetry={refresh} />;
    return <NoAdminAccess email={email} />;
  }

  return (
    <AdminLayout>
      <ErrorBoundary resetKeys={[location.pathname]}>
        <Suspense fallback={<AdminPageLoading tip="加载页面…" />}>
          <Routes>
            <Route index element={<DashboardContent />} />
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
            {/* 模型配置与调用记录 (2026-10-20) */}
            <Route path="model-config" element={<AdminModelConfigPage />} />
            <Route path="model-calls" element={<AdminModelCallsPage />} />
            {/* 能力管控 (B6): 单项能力上下线 */}
            <Route path="capabilities" element={<AdminCapabilitiesPage />} />
            {/* 任务监控 (B-28~B-33) */}
            <Route path="tasks" element={<AdminTasksPage />} />
            {/* 工单处理 (B7): 客服队列, 与任务监控同组 */}
            <Route path="tickets" element={<AdminTicketsPage />} />
            {/* 能力消耗价 (commerce-design.md §4.4) */}
            <Route path="credit-prices" element={<AdminCreditPricesPage />} />
            {/* 交易后台四页 (B1): 商品 / 订单 / 积分账本 / 保留期清理 */}
            <Route path="products" element={<AdminProductsPage />} />
            <Route path="orders" element={<AdminOrdersPage />} />
            <Route path="credits" element={<AdminCreditsPage />} />
            <Route path="retention" element={<AdminRetentionPage />} />
            {/* 财务 (B3): 支付渠道状态 / 发票审核 / 渠道对账 */}
            <Route path="payment-channels" element={<AdminPaymentChannelsPage />} />
            <Route path="invoices" element={<AdminInvoicesPage />} />
            <Route path="reconciliation" element={<AdminReconciliationPage />} />
            <Route path="legal" element={<AdminLegalPage />} />
            <Route path="notifications" element={<AdminNotificationsPage />} />
            {/* AI 标识样式 (2026-10-21): 文案/字体/配色由浏览器渲成位图, 位置与缩放服务端合成 */}
            <Route path="aigc-label" element={<AdminAigcLabelPage />} />
            {/* 未实现的模块: 显式提示而非静默跳回概览 */}
            <Route path="*" element={<NotImplementedPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </AdminLayout>
  );
}

/**
 * 无后台权限页。
 *
 * 常见误入原因 (按可能性排序), 逐条给出以便自查:
 *   1. 用 C 端账号登录 —— 普通注册用户默认没有后台角色
 *   2. 账号被降权 —— 后台立即生效, 旧token 下次请求即403
 *   3. 账号被禁用 —— 同上
 */
/** 后台身份接口失败(非权限原因)时的显式失败态 —— 提供重试, 不误导成权限问题 */
function AdminLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="adm-noaccess">
      <div className="adm-noaccess-card">
        <h1>后台暂时连不上</h1>
        <p className="adm-noaccess-desc">
          没能取到后台身份信息。这通常是网络中断或服务暂时不可用，与账号权限无关。
        </p>
        <div className="adm-noaccess-reasons">
          <div className="adm-noaccess-reason">
            <strong>错误信息</strong>
            <ul>
              <li>{message}</li>
            </ul>
          </div>
        </div>
        <div className="adm-noaccess-actions">
          <Button type="primary" className="adm-btn is-primary" onClick={onRetry}>
            重新连接
          </Button>
        </div>
      </div>
    </div>
  );
}

function NoAdminAccess({ email }: { email: string | null }) {
  const navigate = useNavigate();
  const { logout } = useAuth();

  return (
    <div className="adm-noaccess">
      <div className="adm-noaccess-card">
        <h1>需要后台权限</h1>
        <p className="adm-noaccess-desc">
          当前账号 <strong>{email ?? '(未登录)'}</strong> 没有运营后台的访问权限。
        </p>

        <div className="adm-noaccess-reasons">
          <div className="adm-noaccess-reason">
            <strong>可能原因</strong>
            <ul>
              <li>使用了 C 端账号登录 —— 普通注册用户默认没有后台角色</li>
              <li>账号的角色已被降权，后台权限立即生效</li>
              <li>账号已被禁用</li>
            </ul>
          </div>
          <div className="adm-noaccess-reason">
            <strong>如何进入</strong>
            <ul>
              <li>
                退出后用运营账号登录：development / test 启动时会自动创建预设管理员；
                production 运行 <code>npm run seed:admin</code> 生成一次性随机密码
              </li>
              <li>已有管理员账号但不知密码：用该账号在「用户管理 → 重置密码」获取临时密码</li>
            </ul>
          </div>
        </div>

        <div className="adm-noaccess-actions">
          <Button type="default" className="adm-btn" onClick={() => navigate('/workbench')}>
            返回工作台
          </Button>
          <Button
            type="primary"
            className="adm-btn is-primary"
            onClick={() => {
              logout();
              navigate('/login');
            }}
          >
            换个账号登录
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * 占位页: 让"待建"菜单项点了有明确反馈, 而不是看起来像坏了。
 *
 * 2026-10-20 区分两种到达路径 —— 此前一律显示「该模块尚未开放」, 但这条 catch-all
 * 同时接住了**纯打错的 URL** (如 /admin/uesrs), 用户看到「计划在后续批次交付」
 * 会以为这真是个做了一半的模块, 而不是自己敲错了地址。故比对侧栏菜单:
 * 命中 planned 项 → 说「尚未开放」; 未命中任何菜单项 → 如实说「页面不存在」。
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
