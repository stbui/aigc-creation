import type { ReactNode } from 'react';
import { ToastProvider } from '~/admin-ui/providers/ToastProvider';
import { ConfirmProvider } from '~/admin-ui/providers/ConfirmProvider';
import { AppProvider } from './AppProvider';

/**
 * C 端 UI 运行时。
 *
 * 复用后台已经验证过的 toast / confirm 实现，避免 C 端再写一套反馈语义。
 * `AppProvider` 必须在两者之内：它把 `message` / `modal` 组合成页面使用的
 * `useApp()`，并自己渲染确认弹窗。
 * 与后台不同的是：这里不挂 TooltipProvider，C 端当前没有 tooltip 依赖。
 */
export function UiProvider({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AppProvider>{children}</AppProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
