/**
 * C 端页面外壳入口。外部（`App.tsx`、页面）从这里取件，目录内文件按 `./X` 互引。
 * 后台外壳在 `admin-ui/shell`；身份域弹窗留在 `components/`。
 */
export { AppLayout } from './AppLayout';
export { AppHeader } from './AppHeader';
export { AppSidebar } from './AppSidebar';
export { CapabilityIcon, SideRail } from './SideRail';
export { GuestPromoDialog } from './GuestPromoDialog';
export { NotificationBell } from './NotificationBell';
export { UserAccountMenu } from './UserAccountMenu';
export { RouteExperience } from './RouteExperience';
