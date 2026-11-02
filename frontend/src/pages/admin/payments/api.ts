/**
 * 支付充值的接口入口 —— 目录内文件的唯一外部接口来源。
 *
 * 约定：`payments/` 下的文件不从 `src/lib/api` 直接取东西，一律经由本文件 ——
 * 页面与四个标签用到的接口对象集中可见，替换实现或加埋点只改一处。
 * 目录内新增接口引用时在这里补一行 re-export。
 *
 * 类型契约在 `src/types/payment.ts`（纯类型模块，各文件可直接 `import type`）。
 */

import {
  adminPaymentOrdersApi,
  adminPaymentProductsApi,
  adminPaymentProvidersApi,
  adminPaymentReconciliationApi,
} from '../../../lib/api';

export {
  adminPaymentOrdersApi,
  adminPaymentProductsApi,
  adminPaymentProvidersApi,
  adminPaymentReconciliationApi,
};
