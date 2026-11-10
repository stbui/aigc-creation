import { lazy, type ComponentType } from 'react';

/**
 * 后台子路由页面的懒加载表。
 *
 * `/admin` 外壳本身已经是懒加载，但此前外壳一次性静态导入全部页面，进入概览
 * 时仍要下载整包后台代码。这里保留外壳与概览同步加载，其余页面在首次导航到
 * 对应路由时再请求各自 chunk；Suspense 放在 AdminShell 内，加载期间侧栏不
 * 消失，避免整屏闪白。
 *
 * 本文件只做「路由路径 → 懒加载组件」的声明，不含任何渲染逻辑；路由挂载见
 * `AdminShell.tsx`，侧栏菜单的事实源是 `components/admin/adminNav.ts`。
 */
function lazyAdminPage<T extends Record<string, ComponentType<any>>>(
  loader: () => Promise<T>,
  name: keyof T & string,
) {
  return lazy(() => loader().then((m) => ({ default: m[name] })));
}

export const AdminUsersPage = lazyAdminPage(() => import('./users'), 'AdminUsersPage');
export const AdminRolesPage = lazyAdminPage(() => import('./roles'), 'AdminRolesPage');
export const AdminSettingsPage = lazyAdminPage(() => import('./settings'), 'AdminSettingsPage');
export const AdminBackupPage = lazyAdminPage(() => import('./backups'), 'AdminBackupPage');
export const AdminAssetsPage = lazyAdminPage(() => import('./assets'), 'AdminAssetsPage');
export const AdminStoragePage = lazyAdminPage(() => import('./storage'), 'AdminStoragePage');
export const AdminCouponsPage = lazyAdminPage(() => import('./coupons'), 'AdminCouponsPage');
export const AdminCampaignsPage = lazyAdminPage(() => import('./campaigns'), 'AdminCampaignsPage');
export const AdminMarketingRulesPage = lazyAdminPage(
  () => import('./marketing-rules'),
  'AdminMarketingRulesPage',
);
export const AdminSchedulerPage = lazyAdminPage(() => import('./scheduler'), 'AdminSchedulerPage');
export const AdminModelCallsPage = lazyAdminPage(
  () => import('./model-calls'),
  'AdminModelCallsPage',
);
// 模型层后台：渠道工作台 / 能力与模型 / 用户分组 / 插件 / 账单
export const AdminChannelsPage = lazyAdminPage(() => import('./channels'), 'AdminChannelsPage');
export const AdminUserGroupsPage = lazyAdminPage(
  () => import('./user-groups'),
  'AdminUserGroupsPage',
);
export const AdminPluginsPage = lazyAdminPage(() => import('./plugins'), 'AdminPluginsPage');
export const AdminBillingOrdersPage = lazyAdminPage(
  () => import('./billing-orders'),
  'AdminBillingOrdersPage',
);
export const AdminFinancePage = lazyAdminPage(() => import('./finance'), 'AdminFinancePage');
export const AdminCapabilitiesPage = lazyAdminPage(
  () => import('./capabilities'),
  'AdminCapabilitiesPage',
);
export const AdminTasksPage = lazyAdminPage(() => import('./tasks'), 'AdminTasksPage');
export const AdminTicketsPage = lazyAdminPage(() => import('./tickets'), 'AdminTicketsPage');
export const AdminProductsPage = lazyAdminPage(() => import('./products'), 'AdminProductsPage');
export const AdminMembershipPlansPage = lazyAdminPage(
  () => import('./membership-plans'),
  'AdminMembershipPlansPage',
);
export const AdminOrdersPage = lazyAdminPage(() => import('./orders'), 'AdminOrdersPage');
export const AdminCreditsPage = lazyAdminPage(() => import('./credits'), 'AdminCreditsPage');
export const AdminRetentionPage = lazyAdminPage(() => import('./retention'), 'AdminRetentionPage');
export const AdminInvoicesPage = lazyAdminPage(() => import('./invoices'), 'AdminInvoicesPage');
export const AdminPaymentsPage = lazyAdminPage(() => import('./payments'), 'AdminPaymentsPage');
export const AdminLegalPage = lazyAdminPage(() => import('./legal'), 'AdminLegalPage');
export const AdminNotificationsPage = lazyAdminPage(
  () => import('./notifications'),
  'AdminNotificationsPage',
);
export const AdminAigcLabelPage = lazyAdminPage(
  () => import('./aigc-label'),
  'AdminAigcLabelPage',
);
export const AdminAlertsPage = lazyAdminPage(() => import('./alerts'), 'AdminAlertsPage');
