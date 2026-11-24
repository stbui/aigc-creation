import type { ConfigService } from '@nestjs/config';
import type { PaymentAdapterDescriptor } from './adapters/types';

export type PaymentConfigWarning = { level: 'danger' | 'warn'; message: string };

/**
 * 渠道可用性告警的唯一实现。
 *
 * 后台实例卡片与 C 端选路共用：`danger` 会同时让后台标红、让前台隐藏按钮，
 * 两边各写一份迟早会出现「后台说能付、前台不显示」。
 */
export function paymentConfigWarnings(
  descriptor: PaymentAdapterDescriptor,
  row: { enabled: boolean } | null,
  values: Record<string, string>,
  missing: string[],
  config: ConfigService,
  hasOpenOrders = false,
): PaymentConfigWarning[] {
  const warnings: PaymentConfigWarning[] = [];
  if (row?.enabled && missing.length > 0) {
    warnings.push({
      level: 'danger',
      message: `实例已启用但缺少必填项：${missing.join(', ')}。发起支付会返回 503。`,
    });
  }
  if (
    row?.enabled &&
    descriptor.id !== 'sandbox' &&
    missing.length === 0 &&
    !values.publicBaseUrl?.trim() &&
    !config.get<string>('payment.notifyBase')?.trim()
  ) {
    warnings.push({
      level: 'danger',
      message:
        '实例已启用但未配置回调公网地址：请在实例配置填写 publicBaseUrl，或设置 PAYMENT_NOTIFY_BASE；否则发起支付会返回 503。',
    });
  }
  if (
    row?.enabled &&
    descriptor.id !== 'sandbox' &&
    config.get<string>('app.env') === 'production' &&
    !config.get<string>('payment.secretKey')?.trim()
  ) {
    warnings.push({
      level: 'danger',
      message: '生产环境未配置 PAYMENT_SECRET_KEY，支付实例凭据无法安全加密/解密。',
    });
  }
  if (descriptor.id === 'sandbox' && config.get<string>('app.env') === 'production') {
    warnings.push({
      level: 'danger',
      message: '生产环境仍启用沙箱渠道：不会产生真实资金流转，上线前必须停用。',
    });
  }
  if (row?.enabled && hasOpenOrders) {
    warnings.push({
      level: 'warn',
      message: '存在未完成订单引用当前实例，保存新版本不会影响这些订单的验签与查单。',
    });
  }
  return warnings;
}
