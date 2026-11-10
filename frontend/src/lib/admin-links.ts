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

/**
 * 某个商品的全部订单。
 *
 * 商品卡上的「N 单」用它跳转：运营点数字就想看是哪几单，而不是自己
 * 记住 SKU 再去订单页手填。
 *
 * `productName` 只用于筛选条上的可读标签（订单列表不认识商品 id），
 * 真正的筛选口径是 `productId`。
 */
export function adminProductOrdersHref(productId: string, productName?: string): string {
  return href('/admin/orders', { productId, productName });
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

export function adminModelCallsHref(filters: {
  taskId?: string;
  channelId?: string;
  model?: string;
  source?: string;
  operation?: string;
}): string {
  return href('/admin/model-calls', filters);
}

/**
 * 渠道工作台深链。
 *
 * 给了 `channelId` 就直接选中该渠道（渠道页用 `?id=`）；不给则落在列表首页 ——
 * 「这台机器为什么不可用」从能力卡与任务失败都能一键跳到供应侧。
 */
export function adminChannelHref(channelId?: string): string {
  return href('/admin/channels', { id: channelId });
}

export function adminBillingOrdersHref(filters: { taskId?: string }): string {
  return href('/admin/billing-orders', filters);
}

/** 单条生成账单的详情深链（账单页支持 `?id=`） */
export function adminBillingOrderDetailHref(billingOrderId: string): string {
  return href('/admin/billing-orders', { id: billingOrderId });
}

export function adminTasksHref(filters: { userId?: string; projectId?: string }): string {
  return href('/admin/tasks', filters);
}

export function adminAssetHref(assetId: string): string {
  return href('/admin/assets', { q: assetId });
}
