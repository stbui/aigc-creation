import { useMemo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAdmin } from '../../../context/AdminContext';
import { NoPageAccess } from './NoPageAccess';
import { resolveAdminRouteAccess } from './adminRouteAccess';

/**
 * 后台路由级授权守卫：包住 `Routes`，在渲染任何子页面之前判定权限。
 *
 * 位置在 `AdminUIProvider` 之内、`Routes` 之外 —— 这样拒绝页仍带后台外壳
 * （侧栏 + 顶栏），用户能直接换到有权限的模块，而不是掉到一个孤零零的全屏页。
 *
 * **重新判定**：`useLocation` 订阅路由变化，`pathname` 或 `search` 任一变化都会
 * 重算。`payments` 页挂载后会把裸路径规范化成 `?tab=providers`，那次跳转会让
 * 兜底判定（三条菜单项取并集）换成精确判定（单条菜单项）。
 *
 * **不闪「无权限」**：能走到这里说明 `/admin/me` 已成功返回（`layout.tsx` 在
 * `loading` / `!me` 时就分流了），权限集是就绪的。仍保留 `loading` 分支，是为了
 * 将来若有人调整上层分流，也不会在权限未就绪时先渲染一次拒绝页。
 */
export function AdminRouteGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { can, loading } = useAdmin();
  const path = `${location.pathname}${location.search}`;

  const decision = useMemo(() => resolveAdminRouteAccess(path, can), [path, can]);

  if (loading) return null;
  if (decision.kind === 'deny') {
    return <NoPageAccess path={decision.path} required={decision.required} />;
  }
  return <>{children}</>;
}
