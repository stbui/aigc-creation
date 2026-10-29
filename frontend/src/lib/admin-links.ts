/**
 * 后台跨模块深链。
 *
 * 详情抽屉里的用户、订单、任务、积分、素材入口都复用各列表页已有的查询
 * 参数，不在前端造第二套筛选协议。集中在这里是为了统一编码方式，并让
 * 「某个页面支持哪些筛选键」在调用处一目了然。
 */
type QueryValue = string | undefined;

function href(path: string, params: Record<string, QueryValue>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export function adminUserHref(email: string): string {
  return href('/admin/users', { q: email });
}

export function adminUserDetailHref(userId: string): string {
  return href('/admin/users', { id: userId });
}

export function adminOrderHref(filters: { orderNo?: string; email?: string }): string {
  return href('/admin/orders', filters);
}

export function adminOrderDetailHref(orderId: string): string {
  return href('/admin/orders', { id: orderId });
}

export function adminCreditHref(filters: { userId?: string; email?: string }): string {
  return href('/admin/credits', filters);
}

export function adminTaskHref(id: string): string {
  return href('/admin/tasks', { id });
}

export function adminTasksHref(filters: { userId?: string; projectId?: string }): string {
  return href('/admin/tasks', filters);
}

export function adminAssetHref(assetId: string): string {
  return href('/admin/assets', { q: assetId });
}
