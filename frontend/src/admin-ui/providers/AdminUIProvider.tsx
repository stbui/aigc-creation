import type { ReactNode } from 'react';
import { TooltipProvider } from '../components/ui/tooltip';
import { ToastProvider } from './ToastProvider';
import { ConfirmProvider } from './ConfirmProvider';

/**
 * 后台 UI 运行时。
 *
 * 只挂在 `/admin` 路由内，C 端不加载这些 provider —— 消费级页面不该为了
 * 一个后台 toast 容器多付一份运行时，也不该把浮层的焦点管理带进主站。
 *
 * `TooltipProvider` 是 radix 的全局上下文（延迟、跳过动画）；不挂它，
 * `Tooltip` 会在运行时抛错。延迟 300ms：侧栏折叠态下每个图标都有提示，
 * 鼠标横扫时不该一路弹气泡。
 */
export function AdminUIProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={300}>
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ToastProvider>
    </TooltipProvider>
  );
}
