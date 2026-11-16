/**
 * 支付配置的类型出口 —— 目录内文件的唯一类型来源。
 *
 * 外部类型（`types/payment`）在此统一 re-export，业务文件一律从 `./types` 取。
 * 注意 `types/payment` 不是纯类型模块：`RECONCILIATION_RESULT_LABELS` 是运行期
 * 常量，按约定落 `./constants`，不经本文件转出。
 */

export type {
  AdminPageResult,
  AdminPaymentException,
  AdminPaymentProviderInstanceView,
  AdminPaymentProviderView,
  AdminPaymentSettings,
  AdminReconciliationItem,
  AdminReconciliationRun,
  PaymentConfigField,
  PaymentCurrency,
  PaymentExceptionStatus,
  PaymentProviderConfigUpdate,
  PaymentProviderId,
  PaymentSource,
  VisiblePaymentMethod,
} from '../../../types/payment';
