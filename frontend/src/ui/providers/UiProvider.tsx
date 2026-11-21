import type { ReactNode } from 'react';
import { ToastProvider } from '~/admin-ui/providers/ToastProvider';
import { ConfirmProvider } from '~/admin-ui/providers/ConfirmProvider';
import { TooltipProvider } from '~/admin-ui/components/ui/tooltip';
import { AppProvider } from './AppProvider';

/**
 * C 端 UI 运行时。
 *
 * 复用后台已经验证过的 toast / confirm 实现，避免 C 端再写一套反馈语义。
 * `AppProvider` 必须在两者之内：它把 `message` / `modal` 组合成页面使用的
 * `useApp()`，并自己渲染确认弹窗。
 *
 * `TooltipProvider` 是 2026-11-20 补上的：商品 SKU 图历史卡把悬停动作换成
 * `Tooltip` 后，C 端第一次真正依赖它 —— 缺 Provider 时 Radix 不会抛错，
 * 而是 tooltip 永不显示（静默失效）。
 */
export function UiProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AppProvider>{children}</AppProvider>
        </ConfirmProvider>
      </ToastProvider>
    </TooltipProvider>
  );
}
