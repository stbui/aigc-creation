import type { Payment } from '../generated/prisma/client';
import type {
  PaymentConfigField,
  PaymentCurrency,
  PaymentProviderId,
  VisiblePaymentMethod,
} from './adapters/types';

/**
 * 支付渠道配置的类型单一事实源。
 *
 * 只放数据结构：适配器凭据视图、后台视图、C 端可见支付方式与预占输入输出。
 * 运行时规则（版本链、加密、来源选择）在 `payment-config*.ts` 各实现里。
 */

/** 解密后的实例配置（适配器唯一可用的凭据来源） */
export interface ResolvedPaymentConfig {
  id: string;
  providerId: PaymentProviderId;
  instanceId: string;
  name: string | null;
  sortOrder: number;
  version: number;
  enabled: boolean;
  closeAfterMinutes: number;
  minAmountCents: number | null;
  maxAmountCents: number | null;
  dailyLimitCents: number | null;
  refundEnabled: boolean;
  paymentMethods: VisiblePaymentMethod[];
  values: Record<string, string>;
}

export interface AdminPaymentProviderInstanceView {
  instanceId: string;
  providerId: PaymentProviderId;
  name: string | null;
  sortOrder: number;
  enabled: boolean;
  configured: boolean;
  closeAfterMinutes: number;
  version: number | null;
  configId: string | null;
  values: Record<string, string>;
  secretConfigured: Record<string, boolean>;
  minAmountCents: number | null;
  maxAmountCents: number | null;
  dailyLimitCents: number | null;
  refundEnabled: boolean;
  paymentMethods: VisiblePaymentMethod[];
  identityLockedFields: string[];
  hasOpenOrders: boolean;
  updatedAt: string | null;
  warnings: Array<{ level: 'danger' | 'warn'; message: string }>;
}

export interface AdminPaymentProviderView {
  id: PaymentProviderId;
  name: string;
  icon: string;
  checkoutMode: string;
  /** 任一实例启用；保留给旧前端/旧调用方 */
  enabled: boolean;
  /** 任一实例配置完整；保留给旧前端/旧调用方 */
  configured: boolean;
  closeAfterMinutes: number;
  version: number | null;
  configId: string | null;
  configEnabled: boolean;
  values: Record<string, string>;
  secretConfigured: Record<string, boolean>;
  configFields: PaymentConfigField[];
  supportedCurrencies: PaymentCurrency[];
  supportsReconciliation: boolean;
  missing: string[];
  identityLockedFields: string[];
  hasOpenOrders: boolean;
  updatedAt: string | null;
  warnings: Array<{ level: 'danger' | 'warn'; message: string }>;
  instances: AdminPaymentProviderInstanceView[];
}

export interface AvailableProviderView {
  id: PaymentProviderId;
  name: string;
  icon: string;
  checkoutMode: string;
  supportedCurrencies: PaymentCurrency[];
  sandbox: boolean;
}

/** C 端唯一可见的支付方式视图；不暴露真实渠道与来源。 */
export interface VisiblePaymentProviderView {
  id: VisiblePaymentMethod;
  name: string;
  icon: 'alipay' | 'wechat';
  checkoutMode: string;
  supportedCurrencies: PaymentCurrency[];
  sandbox: false;
}

export interface ResolvedVisiblePayment {
  method: VisiblePaymentMethod;
  providerId: PaymentProviderId;
  config: ResolvedPaymentConfig;
  /** EasyPay 需要按 C 端支付方式下单与验签；官方渠道不填。 */
  providerMethod?: VisiblePaymentMethod;
  /** 轮询下单快照；创建渠道订单前必须原子领取游标。 */
  roundRobin?: {
    providerId: PaymentProviderId;
    method: VisiblePaymentMethod;
    cursor: number;
    eligibleInstances: Array<{
      instanceId: string;
      config: ResolvedPaymentConfig;
    }>;
  };
}

export interface ReserveVisiblePaymentAttemptInput {
  method: VisiblePaymentMethod;
  currency: PaymentCurrency;
  amountCents: number;
  orderId: string;
  userId: string;
  /** 展示阶段已解析的路由；仅用于发现来源切换，最终实例与版本会在事务内重读。 */
  resolved?: ResolvedVisiblePayment;
}

export interface ReservedVisiblePaymentAttempt {
  payment: Payment;
  resolved: ResolvedVisiblePayment;
}

export interface VisiblePaymentOption {
  view: VisiblePaymentProviderView;
  resolved: ResolvedVisiblePayment;
}

export interface SavePaymentInstanceInput {
  enabled: boolean;
  closeAfterMinutes: number;
  values: Record<string, string>;
  name?: string | null;
  minAmountCents?: number | null;
  maxAmountCents?: number | null;
  dailyLimitCents?: number | null;
  refundEnabled?: boolean;
  paymentMethods?: VisiblePaymentMethod[];
}
