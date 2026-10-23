/**
 * 未保存变更守卫的登记处。
 *
 * 为什么要有这一层: 本项目用的是**声明式路由器** (`<BrowserRouter>` + `<Routes>`)，
 * react-router 的 `useBlocker` 只在数据路由 (createBrowserRouter) 下可用。
 * 但"改了没保存就跳走"是真实的数据丢失 —— 后台 AI 标识页改了角标文案后点侧栏，
 * 改动直接消失且没有任何提示。于是用一个极小的登记处让外壳统一拦截站内跳转。
 *
 * 使用方式:
 *   编辑页调用 `useUnsavedGuard(dirty)`，外壳 (AdminLayout) 在捕获到站内链接点击时
 *   调 `hasUnsavedChanges()`，为真则先弹确认再放行。
 *
 * ⚠ 只会拦「点了链接」这一条路径。浏览器前进/后退与地址栏直接改地址不经过这里，
 *   那两类由 `beforeunload` 兜住 (刷新/关闭) 或无法拦截 (SPA 后退) ——
 *   外壳已尽力，不要在编辑页里假设"绝不会丢"。
 */
type Guard = () => boolean;

const guards = new Set<Guard>();

/** 注册一个"是否脏"的判定函数, 返回注销函数 */
export function registerUnsavedGuard(guard: Guard): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

/** 当前是否有任何已注册的编辑页处于未保存状态 */
export function hasUnsavedChanges(): boolean {
  for (const guard of guards) {
    try {
      if (guard()) return true;
    } catch {
      /* 单个守卫抛错不应阻断跳转判定 */
    }
  }
  return false;
}
