import type { Order } from '../../types/api';
import type { FilterValue } from './constants';

/**
 * 我的订单页面的纯函数与外部工具出口 —— 目录内文件的唯一本页工具来源。
 *
 * 本页的外部依赖 (接口 / 组件 / hook) 分别走 `api.ts` / `components.ts` /
 * `hooks.ts`; 这里只放不依赖 React 的筛选、可支付判定与金额 / 时间格式化。
 */

/** 金额 / 日期格式化统一走 `lib/format`，避免各页各写一份后口径漂移 */
export { formatDateTime, formatYuan } from '../../lib/format';

/** 到账后同步顶栏余额（充值积分这时才真的出现） */
export { notifyCreditsChanged } from '../../context/CreditsContext';

/** 两种退款状态在筛选里合并成同一个档位 */
export function matchesFilter(o: Order, filter: FilterValue): boolean {
  if (filter === 'all') return true;
  if (filter === 'refund') return o.status === 'refunded' || o.status === 'partial_refunded';
  return o.status === filter;
}

/** 待支付订单是否还在有效期内（后端 ORDER_TTL_MINUTES） */
export function canPay(o: Order): boolean {
  if (o.status !== 'pending') return false;
  return new Date(o.expiresAt).getTime() > Date.now();
}
