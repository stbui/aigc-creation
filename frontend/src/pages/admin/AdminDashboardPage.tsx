import { lazy, Suspense, useState, type ComponentType } from 'react';
import { Button, Segmented } from 'antd';
import { Navigate, Route, Routes, useLocation, useNavigate, Link } from 'react-router-dom';
import { adminApi } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useAdmin } from '../../context/AdminContext';
import { Activity, ChevronRight, ImageOff, Users } from 'lucide-react';
import { AdminLayout, AdminPageLoading, findAdminMenuItem } from '../../components/admin/AdminLayout';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { ExceptionPage } from '../../components/ExceptionPage';
import { PageHeader, StatusTag } from '../../components/admin/PageHeader';
import { AdminStaleError, useAdminResource } from '../../components/admin/AdminWidgets';
import { toAbsoluteUrl } from '../../lib/api';
import { taskErrorLabel } from '../../lib/admin-error-codes';

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
 * 平台概览页 (M2 骨架)。
 *
 * 交易域相关指标在 M9 上线前不出现 —— 不填0 值占位, 空卡片比没有更困惑。
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

  const t = data.totals;
  const c = data.commerce;
  const w = data.window;
  const cmp = data.comparison;
  const maxTrend = Math.max(...data.trend.map((d) => d.total), 1);
  const activeNow = t.running + t.pending;
  // 收入柱高以窗口内峰值为基准; 全 0 时取 1 避免除零
  const revPeak = Math.max(...c.revenueTrend.map((d) => d.gmvCents), 1);

  return (
    <>
      <PageHeader
        title="平台概览"
        description={`用户、内容与生成任务的整体运行情况 · 数据截至 ${new Date(
          data.generatedAt,
        ).toLocaleTimeString('zh-CN', { hour12: false })}（${data.cacheTtlSeconds} 秒缓存）`}
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
       * 统计卡分两层: 前两张为「规模」主指标(带图标与强调底), 其余为次级指标。
       * 六张同权重平铺会让视线无处落点 —— 用户看不出哪个数最重要。
       */}
      <div className="adm-stat-grid">
        <div className="adm-stat is-primary">
          <div className="adm-stat-head">
            <span className="adm-stat-label">用户总数</span>
            <Users className="adm-stat-icon" size={16} />
          </div>
          <div className="adm-stat-value">{t.users.toLocaleString('zh-CN')}</div>
          <div className="adm-stat-hint">近 {days} 天新增 {t.newUsers}</div>
        </div>

        <div className="adm-stat is-primary">
          <div className="adm-stat-head">
            <span className="adm-stat-label">任务总数</span>
            <Activity className="adm-stat-icon" size={16} />
          </div>
          <div className="adm-stat-value">{t.tasks.toLocaleString('zh-CN')}</div>
          <div className="adm-stat-hint">
            成功 {t.succeeded} · 失败 {t.failed}
          </div>
        </div>

        <div className="adm-stat">
          <div className="adm-stat-head">
            <span className="adm-stat-label">成功率</span>
          </div>
          {/* null 表示窗口内无已完成任务 —— 显示「—」而非 0%, 0% 会被误读为全部失败 */}
          <div
            className={`adm-stat-value${
              t.successRate !== null && t.successRate < 90 ? ' is-danger' : ''
            }`}
          >
            {t.successRate === null ? '—' : `${t.successRate}%`}
          </div>
          <div className="adm-stat-hint">
            {t.successRate === null ? '暂无已完成任务' : '已完成的成功占比'}
          </div>
        </div>

        <div className="adm-stat">
          <div className="adm-stat-head">
            <span className="adm-stat-label">进行中</span>
          </div>
          <div className="adm-stat-value">{activeNow}</div>
          <div className="adm-stat-hint">运行 {t.running} · 等待 {t.pending}</div>
        </div>

        <div className="adm-stat">
          <div className="adm-stat-head">
            <span className="adm-stat-label">项目</span>
          </div>
          <div className="adm-stat-value">{t.projects.toLocaleString('zh-CN')}</div>
          <div className="adm-stat-hint">用户创建的项目总数</div>
        </div>

        <div className="adm-stat">
          <div className="adm-stat-head">
            <span className="adm-stat-label">素材</span>
          </div>
          <div className="adm-stat-value">{t.assets.toLocaleString('zh-CN')}</div>
          <div className="adm-stat-hint">上传 {t.originals} · 生成 {t.generated}</div>
        </div>
      </div>

      {/*
       * 窗口表现：与上面的累计口径分开。
       *
       * 「任务总数 / 成功率」是历史累计，运营真正要看的是「最近这一档在变好
       * 还是变坏」。环比用紧邻的等长窗口，不用累计做分母 —— 否则任何窗口
       * 看起来都在增长。
       */}
      <div className="adm-panel">
        <div className="adm-panel-title">
          近 {days} 天表现
          <span className="adm-panel-note">对比上一个 {days} 天</span>
        </div>
        <div className="adm-stat-grid">
          <div className="adm-stat is-primary">
            <div className="adm-stat-head">
              <span className="adm-stat-label">任务量</span>
              <Activity className="adm-stat-icon" size={16} />
            </div>
            <div className="adm-stat-value">{w.tasks.toLocaleString('zh-CN')}</div>
            <div className="adm-stat-hint">
              <Delta current={w.tasks} previous={cmp.tasks} /> · 上一窗口 {cmp.tasks}
            </div>
          </div>

          <div className="adm-stat">
            <div className="adm-stat-head">
              <span className="adm-stat-label">成功率</span>
            </div>
            <div
              className={`adm-stat-value${
                w.successRate !== null && w.successRate < 90 ? ' is-danger' : ''
              }`}
            >
              {w.successRate === null ? '—' : `${w.successRate}%`}
            </div>
            <div className="adm-stat-hint">
              <Delta current={w.successRate} previous={cmp.successRate} unit="pp" /> · 成功{' '}
              {w.succeeded} · 失败 {w.failed}
            </div>
          </div>

          <div className="adm-stat">
            <div className="adm-stat-head">
              <span className="adm-stat-label">新增用户</span>
              <Users className="adm-stat-icon" size={16} />
            </div>
            <div className="adm-stat-value">{w.revenue.usersNew.toLocaleString('zh-CN')}</div>
            <div className="adm-stat-hint">
              <Delta current={w.revenue.usersNew} previous={cmp.usersNew} /> · 上一窗口{' '}
              {cmp.usersNew}
            </div>
          </div>

          <div className="adm-stat">
            <div className="adm-stat-head">
              <span className="adm-stat-label">营收</span>
            </div>
            <div className="adm-stat-value">¥{yuan(w.revenue.gmvCents)}</div>
            <div className="adm-stat-hint">
              <Delta current={w.revenue.gmvCents} previous={cmp.gmvCents} /> · 上一窗口 ¥
              {yuan(cmp.gmvCents, 0)}
            </div>
          </div>

          <div className="adm-stat">
            <div className="adm-stat-head">
              <span className="adm-stat-label">支付订单</span>
            </div>
            <div className="adm-stat-value">{w.revenue.paidOrders.toLocaleString('zh-CN')}</div>
            <div className="adm-stat-hint">
              <Delta current={w.revenue.paidOrders} previous={cmp.paidOrders} /> · 上一窗口{' '}
              {cmp.paidOrders}
            </div>
          </div>

          <div className="adm-stat">
            <div className="adm-stat-head">
              <span className="adm-stat-label">退款</span>
            </div>
            <div className={`adm-stat-value${w.revenue.refundedCents > 0 ? ' is-danger' : ''}`}>
              ¥{yuan(w.revenue.refundedCents)}
            </div>
            <div className="adm-stat-hint">
              <Delta current={w.revenue.refundedCents} previous={cmp.refundedCents} inverse /> ·
              上一窗口 ¥{yuan(cmp.refundedCents, 0)}
            </div>
          </div>
        </div>
      </div>

      {/* 失败原因榜：只给数量没有意义，运营要知道「该找通道还是找代码」 */}
      <div className="adm-panel">
        <div className="adm-panel-title">
          近 {days} 天失败原因
          <span className="adm-panel-note">
            {w.failed > 0 ? (
              <Link className="adm-link" to="/admin/tasks?status=failed">
                查看失败任务
              </Link>
            ) : (
              '暂无失败任务'
            )}
          </span>
        </div>
        {w.failed === 0 ? (
          <div className="adm-empty">近 {days} 天没有失败任务</div>
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
      </div>

      {/*
       * 交易概览单独成块: 创作侧指标都在涨、营收却停滞, 是运营最需要看见的信号。
       * 与上面六张卡混排会让人以为 GMV 是"任务数"的另一种说法。
       */}
      <div className="adm-panel">
        <div className="adm-panel-title">
          交易概览
          <span className="adm-panel-note">
            累计 GMV ¥{yuan(c.gmvCents)} · 近 {days} 天 ¥{yuan(c.gmvWindowCents)}
          </span>
        </div>
        <div className="adm-stat-grid">
          <div className="adm-stat is-primary">
            <div className="adm-stat-head">
              <span className="adm-stat-label">近 {days} 天营收</span>
            </div>
            <div className="adm-stat-value">¥{yuan(c.gmvWindowCents)}</div>
            <div className="adm-stat-hint">按支付时间统计 · 实付金额</div>
          </div>

          <div className="adm-stat">
            <div className="adm-stat-head">
              <span className="adm-stat-label">支付成功率</span>
            </div>
            {/* null = 无支付流水, 展示「—」而不是 0% */}
            <div className="adm-stat-value">
              {c.paymentSuccessRate === null ? '—' : `${c.paymentSuccessRate}%`}
            </div>
            <div className="adm-stat-hint">
              {c.paymentSuccessRate === null ? '暂无支付流水' : `成功 ${c.orders.paid} 单`}
            </div>
          </div>

          <div className="adm-stat">
            <div className="adm-stat-head">
              <span className="adm-stat-label">待付订单</span>
            </div>
            <div className="adm-stat-value">{c.orders.pending}</div>
            <div className="adm-stat-hint">金额 ¥{yuan(c.pendingCents)}</div>
          </div>

          <div className="adm-stat">
            <div className="adm-stat-head">
              <span className="adm-stat-label">近 {days} 天退款</span>
            </div>
            <div className={`adm-stat-value${c.refundedWindowCents > 0 ? ' is-danger' : ''}`}>
              ¥{yuan(c.refundedWindowCents)}
            </div>
            <div className="adm-stat-hint">累计 ¥{yuan(c.refundedCents)}</div>
          </div>

          <div className="adm-stat">
            <div className="adm-stat-head">
              <span className="adm-stat-label">有效会员</span>
            </div>
            <div className="adm-stat-value">{c.members.active.toLocaleString('zh-CN')}</div>
            <div className="adm-stat-hint">近 {days} 天新增 {c.members.newInWindow}</div>
          </div>

          <div className="adm-stat">
            <div className="adm-stat-head">
              <span className="adm-stat-label">积分发放</span>
            </div>
            <div className="adm-stat-value">{c.credits.grantedInWindow.toLocaleString('zh-CN')}</div>
            <div className="adm-stat-hint">窗口内消耗 {c.credits.consumedInWindow.toLocaleString('zh-CN')}</div>
          </div>
        </div>

        {/* 收入趋势: 与任务趋势同一套柱状语言, 只换数据源与单位 */}
        <div className="adm-trend-title">
          收入趋势
          <span className="adm-panel-note">按支付时间 · 单位: 元</span>
        </div>
        {c.revenueTrend.every((d) => d.gmvCents === 0) ? (
          <div className="adm-empty">所选窗口内没有支付记录</div>
        ) : (
          <div className="adm-trend">
            <div className="adm-trend-grid" aria-hidden="true">
              {[100, 75, 50, 25, 0].map((p) => (
                <div key={p} className="adm-trend-gridline" style={{ bottom: `${p}%` }} />
              ))}
            </div>
            {c.revenueTrend.map((d) => {
              const h = Math.round((d.gmvCents / revPeak) * 100);
              return (
                <div key={d.date} className="adm-trend-col">
                  <div className="adm-trend-bar-wrap">
                    <div
                      className="adm-trend-bar"
                      style={{ height: `${Math.max(h, d.gmvCents > 0 ? 3 : 0)}%` }}
                      title={`${d.date} · ¥${yuan(d.gmvCents)} · ${d.orders} 单`}
                    >
                      {d.gmvCents > 0 && <span className="adm-trend-value">{yuan(d.gmvCents, 0)}</span>}
                    </div>
                  </div>
                  <div className="adm-trend-label">{d.date.slice(5).replace('-', '/')}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* 渠道构成: 总额之外回答「钱从哪个渠道来」，退款/对账优先看占比高的 */}
        <div className="adm-trend-title">
          收入渠道构成
          <span className="adm-panel-note">近 {days} 天 · 按实付金额</span>
        </div>
        {c.channelMix.length === 0 ? (
          <div className="adm-empty">所选窗口内没有支付记录</div>
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

      {/* 趋势: 柱状 + 网格基线, 让"有多少"可被目测而非读数 */}
      <div className="adm-panel">
        <div className="adm-panel-title">
          任务趋势
          <span className="adm-panel-note">近 {days} 天 · 峰值 {maxTrend} 个/天</span>
        </div>
        {data.trend.every((d) => d.total === 0) ? (
          <div className="adm-empty">所选窗口内没有任务记录</div>
        ) : (
          <div className="adm-trend">
            {/* 网格线: 给柱状图一个基准, 否则高度无从判断 */}
            <div className="adm-trend-grid" aria-hidden="true">
              {[100, 75, 50, 25, 0].map((p) => (
                <div key={p} className="adm-trend-gridline" style={{ bottom: `${p}%` }} />
              ))}
            </div>
            {data.trend.map((d) => {
              const h = Math.round((d.total / maxTrend) * 100);
              const hasFailed = d.failed > 0;
              return (
                <div key={d.date} className="adm-trend-col">
                  <div className="adm-trend-bar-wrap">
                    {/* 有失败任务时用警示色标出: 趋势图不能只展示成功的一面 */}
                    <div
                      className={`adm-trend-bar${hasFailed ? ' has-failed' : ''}`}
                      style={{ height: `${Math.max(h, d.total > 0 ? 3 : 0)}%` }}
                    >
                      {d.total > 0 && <span className="adm-trend-value">{d.total}</span>}
                    </div>
                  </div>
                  <div className="adm-trend-label">{d.date.slice(5).replace('-', '/')}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="adm-panel">
        <div className="adm-panel-title">
          最近任务
          <span className="adm-panel-note">
            <Link className="adm-link" to="/admin/tasks">
              前往任务监控
            </Link>
          </span>
        </div>
        <ul className="adm-task-list">
          {data.recentTasks.map((task) => (
            <li key={task.id}>
              <Link
                className="adm-task-item"
                to={`/admin/tasks?id=${encodeURIComponent(task.id)}`}
                aria-label={`查看任务详情：${task.capabilityName} ${task.id.slice(-8)}`}
              >
                {task.thumbnailUrl ? (
                  <img
                    className="adm-task-thumb"
                    src={toAbsoluteUrl(task.thumbnailUrl)}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <div className="adm-task-thumb is-empty">
                    <ImageOff size={14} />
                  </div>
                )}

                <div className="adm-task-main">
                  {/* 能力名是主信息, 加重; 其余降级为次要信息 */}
                  <div className="adm-task-name">{task.capabilityName}</div>
                  <div className="adm-task-meta">
                    <StatusTag status={task.status} />
                    {task.provider && <span className="adm-task-provider">{task.provider}</span>}
                    <code className="adm-task-id">{task.id.slice(-8)}</code>
                  </div>
                </div>

                <div className="adm-task-time">
                  {/* 相对时间用于快速判断新鲜度, 绝对时间保留在title 里供核对 */}
                  <span title={new Date(task.createdAt).toLocaleString('zh-CN')}>
                    {formatRelative(task.createdAt)}
                  </span>
                </div>
                <ChevronRight className="adm-task-arrow" size={14} aria-hidden="true" />
              </Link>
            </li>
          ))}
          {data.recentTasks.length === 0 && <div className="adm-empty">暂无任务记录</div>}
        </ul>
      </div>
    </>
  );
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

/** 相对时间: 后台看"新旧"比看"几点几分"更常用 */
function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
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
