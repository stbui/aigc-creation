/**
 * 后台入口 barrel。
 *
 * 本文件曾是 1371 行的单体，同时承载「子路由懒加载表 + 后台外壳 + 平台概览」
 * 三件事。现已按职责拆开：
 *
 * - `routes.ts`                          —— 路由路径 → 懒加载组件
 * - `AdminShell.tsx`                     —— 路由守卫 + 布局 + 子路由挂载
 * - `dashboard/AdminDashboardContent.tsx` —— 平台概览（值班台）内容
 *
 * 保留本文件是因为 `App.tsx` 以 `import('./pages/admin/AdminDashboardPage')`
 * 的方式按名取 `AdminShell`；这里的再导出是应用入口契约，不是兼容层。
 */
export { AdminShell } from './AdminShell';
export { AdminDashboardContent } from './dashboard/AdminDashboardContent';
