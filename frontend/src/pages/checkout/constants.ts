import type { CreditBalance, Order } from '../../types/api';

/**
 * 结算页的常量与共享类型 —— 目录内文件的唯一常量入口。
 *
 * 这些值决定「等多久」「什么时候放弃」「输入多长」，散在页面与组件里
 * 会出现「按钮说 5 分钟、轮询 3 分钟」这类对不上的情况。
 *
 * 约定: `checkout/` 下的文件不从 `src/lib/constants` 直接取东西,
 * 一律经由本文件 —— 目录内新增共享常量时在这里补一行。
 */

/** 生产环境开关: 沙箱三态按钮只在非生产渲染 */
export { IS_PROD } from '../../lib/constants';

/** 结算页两个阶段: 确认支付 / 支付结果 */
export type Phase = 'confirm' | 'result';

/** 支付结果视图 */
export interface ResultView {
  kind: 'success' | 'failed' | 'timeout';
  title: string;
  desc: string;
  order: Order;
  /** 支付成功后回查到的最新余额 */
  balance: CreditBalance | null;
}

/** 支付结果轮询间隔 */
export const PAYMENT_POLL_INTERVAL_MS = 2000;

/**
 * 支付结果轮询兜底上限。
 *
 * 正常情况下页面会用 `PaymentIntent.expiresAt`（后端订单过期时间）作为截止；
 * 该常量只在渠道没有返回 expiresAt 时兜底。它必须与后端 ORDER_TTL_MINUTES
 * 一致（30 分钟），否则用户在 5 分钟后完成支付，页面会提前放弃查询。
 */
export const PAYMENT_POLL_TIMEOUT_MS = 30 * 60 * 1000;

/** 券码试算防抖 (输入停止后再请求，避免每敲一个字打一次接口) */
export const QUOTE_DEBOUNCE_MS = 350;

/** 优惠码输入上限 (与后端字段长度一致) */
export const COUPON_MAX_LENGTH = 24;
