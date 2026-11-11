import { useRouteExperience } from './hooks';

/**
 * 路由体验：前进/后退保留滚动位置，新路由回到顶部，悬停预取路由 chunk。
 * 全部行为在 `useRouteExperience` 内，组件本身不渲染任何节点。
 */
export function RouteExperience() {
  useRouteExperience();
  return null;
}
