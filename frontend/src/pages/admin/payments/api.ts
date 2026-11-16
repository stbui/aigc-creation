/**
 * 支付配置的接口入口 —— 目录内文件的唯一外部接口来源。
 *
 * 约定：`payments/` 下的文件不从 `src/lib/api` 直接取东西，一律经由本文件 ——
 * 页面与各标签用到的接口对象集中可见，替换实现或加埋点只改一处。
 * 目录内新增接口引用时在这里补一行 re-export。
 *
 * 类型契约经 `./types` 取（它从 `src/types/payment` 统一转出）；运行期常量
 * `RECONCILIATION_RESULT_LABELS` 按约定在 `./constants`。
 *
 * 商品与订单接口不在这里：充值商品统一由「商品管理」（`/admin/products`）维护，
 * 订单列表与渠道查单/关单统一在「订单管理」（`/admin/orders`）。
 */

import {
  adminPaymentProvidersApi,
  adminPaymentReconciliationApi,
} from '../../../lib/api';
import { adminPaymentExceptionsApi } from '../../../lib/admin-payment-exceptions-api';

export {
  adminPaymentExceptionsApi,
  adminPaymentProvidersApi,
  adminPaymentReconciliationApi,
};
