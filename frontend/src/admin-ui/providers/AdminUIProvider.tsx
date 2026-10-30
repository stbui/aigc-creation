import type { ReactNode } from 'react';
import { ToastProvider } from './ToastProvider';
import { ConfirmProvider } from './ConfirmProvider';

/**
 * 后台 UI 运行时。
 *
 * 只挂在 `/admin` 路由内（AdminDashboardPage），C 端不加载这些 provider，
 * 也不会把 toast 容器与确认弹层的样式带进消费级页面。
 */
export function AdminUIProvider({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  );
}
