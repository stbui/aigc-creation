import { Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAdmin } from '../../context/AdminContext';
import { AdminUIProvider } from '../../admin-ui/providers/AdminUIProvider';
import { AdminBoardLayout } from '../../admin-ui/shell/AdminBoardLayout';
import '../../styles/admin.css';
import { ErrorBoundary } from '../../components/ErrorBoundary';
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
  AdminEmailPage,
  AdminFinancePage,
  AdminInvoicesPage,
  AdminMarketingRulesPage,
  AdminMembershipPlansPage,
  AdminModelCallsPage,
  AdminNotificationsPage,
  AdminOrdersPage,
  AdminPaymentsPage,
  AdminPaymentRulesPage,
  AdminPluginsPage,
  AdminProductsPage,
  AdminPromptsPage,
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
  AdminRadarStylePage,
} from './routes';

// 内部展示组件（加载态 / 鉴权失败 / 无权限 / 占位）拆分到 `layout-parts/`，
// 本文件只留守卫 + 布局壳。
import { AdminLoading } from './layout-parts/AdminLoading';
import { NoAdminLayoutLoading } from './layout-parts/NoAdminLayoutLoading';
import { AdminLoadError } from './layout-parts/AdminLoadError';
import { NoAdminAccess } from './layout-parts/NoAdminAccess';
import { NotImplementedPage } from './layout-parts/NotImplementedPage';

/**
 * 后台布局：路由守卫 + 布局 + 子路由挂载。
 *
 * 从 `AdminDashboardPage.tsx` 抽出。本文件是 `/admin/*` 的唯一装配点，因此
 * `styles/admin.css` 也随之落在这里 —— 后台样式只在进入后台时加载。子页懒加载
 * 表见 `routes.ts`，概览内容见 `dashboard/AdminDashboardContent.tsx`，内部展示
 * 组件见 `layout-parts/`。
 */

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
export function AdminLayout() {
  const { token, email } = useAuth();
  const { me, loading, error, errorStatus, refresh } = useAdmin();
  const location = useLocation();

  if (!token) {
    const redirect = encodeURIComponent(
      `${location.pathname}${location.search}${location.hash}`,
    );
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }
  if (loading) return <NoAdminLayoutLoading />;
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
          <ErrorBoundary resetKeys={[`${location.pathname}${location.search}`]}>
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
              <Route path="email" element={<AdminEmailPage />} />
              {/* 系统设置只接受四个显式页签路由；其他设置路径按未知页面处理。 */}
              <Route path="settings" element={<Navigate to="/admin/settings/generate" replace />} />
              <Route path="settings/generate" element={<AdminSettingsPage group="generate" />} />
              <Route path="settings/upload" element={<AdminSettingsPage group="upload" />} />
              <Route path="settings/backup" element={<AdminSettingsPage group="backup" />} />
              <Route path="settings/performance" element={<AdminSettingsPage group="performance" />} />
              <Route path="settings/security" element={<AdminSettingsPage group="security" />} />
              <Route path="backups" element={<AdminBackupPage />} />
              <Route path="assets" element={<AdminAssetsPage />} />
              <Route path="storage" element={<AdminStoragePage />} />
              <Route path="coupons" element={<AdminCouponsPage />} />
              <Route path="campaigns" element={<AdminCampaignsPage />} />
              <Route path="marketing-rules" element={<AdminMarketingRulesPage />} />
              <Route path="scheduler" element={<AdminSchedulerPage />} />
              {/* 模型层：渠道 → 能力与模型 → 分组 → 插件 → 账单 */}
              <Route path="channels" element={<AdminChannelsPage />} />
              <Route path="user-groups" element={<AdminUserGroupsPage />} />
              <Route path="plugins" element={<AdminPluginsPage />} />
              <Route path="billing-orders" element={<AdminBillingOrdersPage />} />
              <Route path="finance" element={<AdminFinancePage />} />
              <Route path="model-calls" element={<AdminModelCallsPage />} />
              {/* 能力与模型：能力上下线与所属前台模型同一工作台 */}
              <Route path="capabilities" element={<AdminCapabilitiesPage />} />
              {/* 任务监控：与调用记录同组（模型与能力的排障入口） */}
              <Route path="tasks" element={<AdminTasksPage />} />
              {/* 工单处理：客服队列 */}
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
              {/* 支付：收款 / 核对 / 异常在侧栏各有独立入口，共用支付工作台 */}
              <Route path="payments" element={<AdminPaymentsPage />} />
              <Route path="payment-rules" element={<AdminPaymentRulesPage />} />
              {/* 财务：发票审核 */}
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
              <Route path="prompts" element={<AdminPromptsPage />} />
              {/* AI 标识样式 */}
              <Route path="aigc-label" element={<AdminAigcLabelPage />} />
              {/* 中性风格（freebie-radar 设计语言）落地验证页 */}
              <Route path="radar-style" element={<AdminRadarStylePage />} />
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
