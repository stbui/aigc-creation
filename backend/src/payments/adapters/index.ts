import { PaymentAdapter, PaymentProviderId, PAYMENT_PROVIDER_IDS } from './types';
import { SandboxAdapter } from './sandbox.adapter';
import { AlipayAdapter } from './alipay.adapter';
import { WechatAdapter } from './wechat.adapter';
import { PaypalAdapter } from './paypal.adapter';
import { StripeAdapter } from './stripe.adapter';
import { EpayAdapter } from './epay.adapter';
import { ZpayAdapter } from './zpay.adapter';

/**
 * 适配器注册表。唯一事实源是这里 —— 新增渠道只改这一处 + 一个 adapter 文件，
 * 后台「支付渠道」页的字段清单由 `descriptor.configFields` 直接驱动。
 */
const ADAPTERS: Record<PaymentProviderId, PaymentAdapter> = {
  sandbox: new SandboxAdapter(),
  alipay: new AlipayAdapter(),
  wechat: new WechatAdapter(),
  paypal: new PaypalAdapter(),
  stripe: new StripeAdapter(),
  epay: new EpayAdapter(),
  zpay: new ZpayAdapter(),
};

export function getAdapter(providerId: string): PaymentAdapter | null {
  if (!(PAYMENT_PROVIDER_IDS as string[]).includes(providerId)) return null;
  return ADAPTERS[providerId as PaymentProviderId];
}

export function requireAdapter(providerId: string): PaymentAdapter {
  const adapter = getAdapter(providerId);
  if (!adapter) throw new Error(`未知支付渠道: ${providerId}`);
  return adapter;
}

export function allAdapters(): PaymentAdapter[] {
  return PAYMENT_PROVIDER_IDS.map((id) => ADAPTERS[id]);
}

export * from './types';
