import { useEffect, useState } from 'react';
import { App, Button } from 'antd';
import { Navigate, Route, Routes, useLocation, useNavigate, Link } from 'react-router-dom';
import { adminApi } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useAdmin } from '../../context/AdminContext';
import { Activity, ImageOff, Users } from 'lucide-react';
import { AdminLayout, AdminPageLoading, findAdminMenuItem } from '../../components/admin/AdminLayout';
import { ExceptionPage } from '../../components/ExceptionPage';
import { PageHeader, StatusTag } from '../../components/admin/PageHeader';
import { AdminUsersPage } from './AdminUsersPage';
import { AdminRolesPage } from './AdminRolesPage';
import { AdminSettingsPage } from './AdminSettingsPage';
import { AdminAuditPage } from './AdminAuditPage';
import { AdminBackupPage } from './AdminBackupPage';
import { AdminAssetsPage } from './AdminAssetsPage';
import { AdminStoragePage } from './AdminStoragePage';
import { AdminCouponsPage } from './AdminCouponsPage';
import { AdminCampaignsPage } from './AdminCampaignsPage';
import { AdminMarketingRulesPage } from './AdminMarketingRulesPage';
import { AdminSchedulerPage } from './AdminSchedulerPage';
import { AdminModelConfigPage } from './AdminModelConfigPage';
import { AdminModelCallsPage } from './AdminModelCallsPage';
import { AdminTasksPage } from './AdminTasksPage';
import { AdminCreditPricesPage } from './AdminCreditPricesPage';
import type { AdminOverview } from '../../types/api';
import { toAbsoluteUrl } from '../../lib/api';

/**
 * 平台概览页 (M2 骨架)。
 *
 * 交易域相关指标在 M9 上线前不出现 —— 不填0 值占位, 空卡片比没有更困惑。
 */
function DashboardContent() {
  const { message } = App.useApp();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(7);
  /*
   * ⚠ 2026-10-20 修 bug: 原重试按钮是 `setDays((d) => d)` —— 返回同一值,
   * React 判定 state 未变直接 bail out, effect 不重跑, **点「重试」毫无反应**。
   * 改用独立计数器进 effect 依赖, 保证点击必然重新发请求。
   */
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    adminApi
      .overview(days)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : '统计数据加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [days, retryNonce]);

  if (loading) return <AdminPageLoading tip="加载统计数据…" />;
  if (error) {
    return (
      <ExceptionPage
        kind="warning"
        title="统计数据加载失败"
        desc="概览数据未能加载，下方是后端返回的原因。确认服务可用后重试即可，不会影响已产生的任何数据。"
        detail={error}
        action={
          <button type="button" className="exc-btn is-primary" onClick={() => setRetryNonce((n) => n + 1)}>
            重试
          </button>
        }
        showBack={false}
      />
    );
  }
  if (!data) return null;

  const t = data.totals;
  const maxTrend = Math.max(...data.trend.map((d) => d.total), 1);
  const activeNow = t.running + t.pending;

  return (
    <>
      <PageHeader
        title="平台概览"
        description="用户、内容与生成任务的整体运行情况"
        actions={
          <>
            <div className="adm-segmented">
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`adm-segmented-item${days === d ? ' is-active' : ''}`}
                  onClick={() => setDays(d)}
                >
                  近 {d} 天
                </button>
              ))}
            </div>
            <Button onClick={() => void message.info('刷新功能将在数据工具批次开放')}>刷新</Button>
          </>
        }
      />

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
            <li key={task.id} className="adm-task-item">
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
            </li>
          ))}
          {data.recentTasks.length === 0 && <div className="adm-empty">暂无任务记录</div>}
        </ul>
      </div>
    </>
  );
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
  const { me, loading } = useAdmin();

  if (!token) return <Navigate to="/login" replace />;
  if (loading) return <AdminPageLoading tip="校验后台权限…" />;
  if (!me) return <NoAdminAccess email={email} />;

  return (
    <AdminLayout>
      <Routes>
        <Route index element={<DashboardContent />} />
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
        {/* 任务监控 (B-28~B-33) */}
        <Route path="tasks" element={<AdminTasksPage />} />
        {/* 能力消耗价 (commerce-design.md §4.4) */}
        <Route path="credit-prices" element={<AdminCreditPricesPage />} />
        {/* 未实现的模块: 显式提示而非静默跳回概览 */}
        <Route path="*" element={<NotImplementedPage />} />
      </Routes>
    </AdminLayout>
  );
}

/**
 * 无后台权限页。
 *
 * 常见误入原因 (按可能性排序), 逐条给出以便自查:
 *   1. 用C 端账号登录 —— 演示账号 admin@demo.com 就是这种
 *   2. 账号被降权 —— 后台立即生效, 旧token 下次请求即403
 *   3. 账号被禁用 —— 同上
 */
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
              <li>使用了 C 端账号登录 —— 演示账号 admin@demo.com 属于这种情况</li>
              <li>账号的角色已被降权，后台权限立即生效</li>
              <li>账号已被禁用</li>
            </ul>
          </div>
          <div className="adm-noaccess-reason">
            <strong>如何进入</strong>
            <ul>
              <li>
                退出后用运营账号登录：运行 <code>npm run seed:admin</code> 会创建管理员并输出
                一次性随机密码
              </li>
              <li>已有管理员账号但不知密码：用该账号在「用户管理 → 重置密码」获取临时密码</li>
            </ul>
          </div>
        </div>

        <div className="adm-noaccess-actions">
          <button type="button" className="adm-btn" onClick={() => navigate('/workbench')}>
            返回工作台
          </button>
          <button
            type="button"
            className="adm-btn is-primary"
            onClick={() => {
              logout();
              navigate('/login');
            }}
          >
            换个账号登录
          </button>
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
