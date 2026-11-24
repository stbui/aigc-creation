import { findAdminMenuItemsByPath, type AdminMenuItem } from '../../../components/admin/adminNav';

/**
 * 后台路由级授权的判定口径（纯函数，无 React 依赖）。
 *
 * 背景：`layout.tsx` 原先只校验「是不是后台角色」，nav 的 `permission` 只决定
 * 侧栏是否显示。于是 operator / finance 直敲 URL 能进无权限页 —— 有页内总闸的
 * 页面给空态，没有总闸的（storage / backups / scheduler / alerts）直接是接口
 * 错误页。本模块把「路径 → 所需权限」收敛成一处，供 `AdminRouteGuard` 使用。
 *
 * 三条硬规则：
 *
 * 1. **查找用 `findAdminMenuItemsByPath`，不用 `findAdminMenuItem`**。
 *    后者要求 pathname + search 全命中，而 `/admin/payments` 的三条菜单项都带
 *    `?tab=`，裸路径查不到任何项；`payments/page.tsx` 是挂载后才补默认页签，
 *    守卫若在规范化之前返回 undefined 就会被绕过。前者在精确未命中时按
 *    pathname 兜底，正是为这一处准备的。
 *
 * 2. **命中多条时取并集**。裸 `/admin/payments` 兜底出三个页签项，页面随后会
 *    把 URL 规范成其中某一个。只看第一条，既可能拦下一个其实可访问的页签，
 *    也可能放行后落到别的页签再吃 403。并集 + URL 变化后重新判定，是唯一
 *    不会漏判的组合。
 *
 * 3. **0 命中不等于放行**。重定向壳路由（`credit-prices` 等）不在菜单里，
 *    但跳转目标是有权限门槛的真实页面 —— 默认放行等于给它们开了一个后门。
 *    因此这类路径在下方 `ROUTE_ONLY_PERMISSIONS` 里显式映射到目标页权限。
 */

/**
 * 没有对应菜单项、但确有路由的路径 → 所需权限。
 *
 * 这些路由的组件都只渲染 `<Navigate>`，真正的内容在跳转目标页；守卫必须在
 * 跳转前按**目标页**的权限判定。
 *
 * - `/admin/credit-prices` → `/admin/capabilities?tab=pricing`：T-043 之后财务
 *   已无 `product.price` 入口，若这里放行，财务仍可借旧深链进入定价页。
 * - `/admin/payment-channels` → `/admin/payments?tab=providers`
 * - `/admin/reconciliation` → `/admin/payments?tab=reconciliation`
 *
 * 新增重定向壳路由时必须同步补这里，`__tests__/adminRouteAccess.test.ts` 会
 * 对比 `layout.tsx` 的实际路由表，漏补即失败。
 */
export const ROUTE_ONLY_PERMISSIONS: Record<string, readonly string[]> = {
  '/admin/credit-prices': ['capability.read', 'logical_model.read'],
  '/admin/payment-channels': ['payment.read'],
  '/admin/reconciliation': ['payment.read'],
};

/** 不需要任何权限点即可进入的后台路径（菜单项 `permission: null`，如告警）。 */
export const PUBLIC_ADMIN_ROUTES: readonly string[] = ['/admin/alerts'];

export interface AdminRouteDenial {
  /** 判定结果：拒绝 */
  kind: 'deny';
  /** 归一化后的 pathname（去掉 query / hash / 末尾斜杠） */
  path: string;
  /** 任一命中即可进入的权限点 */
  required: string[];
}

export type AdminRouteDecision = { kind: 'allow' } | AdminRouteDenial;

/** `/admin/payments/?tab=x#y` → `/admin/payments` */
function normalizePath(path: string): string {
  const pathname = path.split('#')[0].split('?')[0];
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** 保留 query、归一化 pathname：`/admin/payments/?tab=x` → `/admin/payments?tab=x` */
function normalizeLookupPath(path: string): string {
  const withoutHash = path.split('#')[0];
  const queryIndex = withoutHash.indexOf('?');
  const pathname = normalizePath(withoutHash);
  if (queryIndex === -1) return pathname;
  const search = withoutHash.slice(queryIndex);
  return `${pathname}${search}`;
}

/** 把命中项的 `permission` 展平成权限点并集；`null` 项由调用方单独处理 */
function collectPermissions(items: AdminMenuItem[]): string[] {
  const permissions = new Set<string>();
  for (const item of items) {
    if (item.permission === null) continue;
    const list = Array.isArray(item.permission) ? item.permission : [item.permission];
    for (const permission of list) permissions.add(permission);
  }
  return [...permissions];
}

/**
 * 判定某个后台路径当前账号能否进入。
 *
 * @param path  `location.pathname + location.search`（含 query 才能精确命中页签）
 * @param has   权限判定，通常传 `can`
 *
 * 决策链：
 *   命中菜单项，且有 `permission: null` 的项 → 放行
 *   命中菜单项，且任一所需权限命中       → 放行
 *   命中菜单项，权限全不命中             → 拒绝（列出所需权限）
 *   未命中菜单项，但在重定向壳表里       → 按目标页权限判定
 *   其余（catch-all：打错的地址）        → 放行，交给 `NotImplementedPage` 显示 404
 */
export function resolveAdminRouteAccess(
  path: string,
  has: (permission: string) => boolean,
): AdminRouteDecision {
  const pathname = normalizePath(path);

  const candidates = findAdminMenuItemsByPath(normalizeLookupPath(path));
  if (candidates.length > 0) {
    if (candidates.some((item) => item.permission === null)) return { kind: 'allow' };
    const required = collectPermissions(candidates);
    if (required.some((permission) => has(permission))) return { kind: 'allow' };
    return { kind: 'deny', path: pathname, required };
  }

  const explicit = ROUTE_ONLY_PERMISSIONS[pathname];
  if (explicit) {
    if (explicit.some((permission) => has(permission))) return { kind: 'allow' };
    return { kind: 'deny', path: pathname, required: [...explicit] };
  }

  // catch-all：不存在于菜单也不在重定向壳表里，由 NotImplementedPage 说明
  // 「页面不存在」或「尚未开放」。这里没有可判定的权限门槛。
  return { kind: 'allow' };
}
