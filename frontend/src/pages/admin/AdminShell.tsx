import { Suspense } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAdmin } from '../../context/AdminContext';
import { findAdminMenuItem } from '../../components/admin/adminNav';
import { AdminUIProvider } from '../../admin-ui/providers/AdminUIProvider';
import { AdminBoardLayout } from '../../admin-ui/shell/AdminBoardLayout';
import '../../styles/admin.css';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { ExceptionPage } from '../../components/ExceptionPage';
import { ActionButton, Skeleton } from '../../admin-ui/primitives';
import { AdminDutyProvider } from '../../components/admin/DutyContext';
import { AdminWorkbenchProvider } from '../../components/admin/WorkbenchContext';
import { AdminDashboardContent } from './dashboard/AdminDashboardContent';
import {
  AdminAlertsPage,
  AdminAssetsPage,
  AdminAigcLabelPage,
  AdminBackupPage,
  AdminBillingOrdersPage,
  AdminCampaignsPage,
  AdminCapabilitiesPage,
  AdminChannelsPage,
  AdminCouponsPage,
  AdminCreditsPage,
  AdminFinancePage,
  AdminInvoicesPage,
  AdminMarketingRulesPage,
  AdminMembershipPlansPage,
  AdminModelCallsPage,
  AdminNotificationsPage,
  AdminOrdersPage,
  AdminPaymentsPage,
  AdminPluginsPage,
  AdminProductsPage,
  AdminRetentionPage,
  AdminRolesPage,
  AdminSchedulerPage,
  AdminSettingsPage,
  AdminStoragePage,
  AdminTasksPage,
  AdminTemplatesPage,
  AdminTicketsPage,
  AdminUserGroupsPage,
  AdminUsersPage,
} from './routes';

/**
 * 后台外壳：路由守卫 + 布局 + 子路由挂载。
 *
 * 从 `AdminDashboardPage.tsx` 抽出。本文件是 `/admin/*` 的唯一装配点，因此
 * `styles/admin.css` 也随之落在这里 —— 后台样式只在进入后台时加载。子页懒加载
 * 表见 `routes.ts`，概览内容见 `dashboard/AdminDashboardContent.tsx`。
 */

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

  if (!token) {
    const redirect = encodeURIComponent(
      `${location.pathname}${location.search}${location.hash}`,
    );
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }
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
      <AdminWorkbenchProvider>
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
                    <AdminDashboardContent />
                  </AdminDutyProvider>
                }
              />
              <Route path="alerts" element={<AdminAlertsPage />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="roles" element={<AdminRolesPage />} />
              <Route path="settings" element={<AdminSettingsPage />} />
              <Route path="backups" element={<AdminBackupPage />} />
              <Route path="assets" element={<AdminAssetsPage />} />
              <Route path="storage" element={<AdminStoragePage />} />
              <Route path="coupons" element={<AdminCouponsPage />} />
              <Route path="campaigns" element={<AdminCampaignsPage />} />
              <Route path="marketing-rules" element={<AdminMarketingRulesPage />} />
              <Route path="scheduler" element={<AdminSchedulerPage />} />
              {/* 模型层：渠道 → 能力与模型 → 分组 → 插件 → 账单 */}
              <Route path="channels" element={<AdminChannelsPage />} />
              <Route
                path="logical-models"
                element={
                  <Navigate
                    to={`/admin/capabilities${location.search}${location.hash}`}
                    replace
                  />
                }
              />
              <Route path="user-groups" element={<AdminUserGroupsPage />} />
              <Route path="plugins" element={<AdminPluginsPage />} />
              <Route path="billing-orders" element={<AdminBillingOrdersPage />} />
              <Route path="finance" element={<AdminFinancePage />} />
              <Route path="model-calls" element={<AdminModelCallsPage />} />
              {/* 能力与模型：能力上下线与所属前台模型同一工作台 */}
              <Route path="capabilities" element={<AdminCapabilitiesPage />} />
              {/* 任务监控 */}
              <Route path="tasks" element={<AdminTasksPage />} />
              {/* 工单处理：客服队列，与任务监控同组 */}
              <Route path="tickets" element={<AdminTicketsPage />} />
              {/* 能力消耗价已并入能力与模型，保留旧地址深链 */}
              <Route
                path="credit-prices"
                element={<Navigate to="/admin/capabilities?tab=pricing" replace />}
              />
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
              <Route path="notifications" element={<AdminNotificationsPage />} />
              <Route path="templates" element={<AdminTemplatesPage />} />
              {/* AI 标识样式 */}
              <Route path="aigc-label" element={<AdminAigcLabelPage />} />
              {/* 未实现的模块：显式提示而非静默跳回概览 */}
              <Route path="*" element={<NotImplementedPage />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
        </AdminBoardLayout>
      </AdminWorkbenchProvider>
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
      <div className="w-[232px] shrink-0 border-r border-border bg-sidebar" aria-hidden />
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
