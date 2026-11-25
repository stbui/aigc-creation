import { CheckCircle2 } from 'lucide-react';

import type { PaymentProviderInfo } from '../../types/payment';

/**
 * 支付方式卡。
 *
 * 生产只展示「支付宝 / 微信支付」两种方式。每种方式背后是官方渠道还是
 * 易支付由管理员选择，本组件不读取也不展示真实服务商身份。
 * 开发/测试环境在沙箱实例启用时额外展示「沙箱（站内模拟）」，
 * 必须写明不产生真实扣款。
 */
export function CheckoutPaymentMethodCard({
  providers,
  selectedProviderId,
  onSelectProvider,
  providersLoading,
  providersError,
  paymentDisabled = false,
}: {
  providers: PaymentProviderInfo[];
  selectedProviderId: string;
  onSelectProvider: (id: string) => void;
  providersLoading: boolean;
  providersError: string | null;
  /** 平台支付开关已关闭：与「渠道未配置」分开文案，避免用户按无效指引操作 */
  paymentDisabled?: boolean;
}) {
  const selected =
    providers.find((p) => p.id === selectedProviderId) ?? providers[0] ?? null;

  return (
    <section className="co-card">
      <div className="co-card-head">
        <h2>
          <span className="co-step">2</span>
          支付方式
        </h2>
      </div>

      {providersLoading && providers.length === 0 ? (
        <div className="co-pay-empty">
          <span className="co-pay-empty-icon" aria-hidden>…</span>
          <p className="co-pay-empty-title">正在读取支付渠道…</p>
        </div>
      ) : providers.length === 0 ? (
        <div className="co-pay-empty is-warn">
          <span className="co-pay-empty-icon" aria-hidden>!</span>
          <div>
            <p className="co-pay-empty-title">
              {paymentDisabled
                ? '支付功能已关闭'
                : providersError
                  ? '支付方式加载失败'
                  : '暂无可用支付方式'}
            </p>
            <p className="co-pay-empty-desc">
              {paymentDisabled
                ? '当前平台暂停收款，暂时无法购买付费商品；如需购买请联系管理员。'
                : (providersError ?? '后台尚未选择可用支付来源，请联系管理员。')}
            </p>
          </div>
        </div>
      ) : (
        <div className="co-pay-list" role="radiogroup" aria-label="选择支付方式">
          {providers.map((provider) => {
            const active = provider.id === selected?.id;
            return (
              <button
                key={provider.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`co-pay-option is-selectable${active ? ' is-active' : ''}`}
                onClick={() => onSelectProvider(provider.id)}
              >
                <span className="co-pay-icon">{providerIcon(provider)}</span>
                <div className="co-pay-body">
                  <div className="co-pay-name">{provider.name}</div>
                  <div className="co-pay-desc">
                    {provider.checkoutMode === 'sandbox'
                      ? '站内模拟支付，不产生真实扣款'
                      : provider.checkoutMode === 'qrcode'
                        ? '扫码完成支付，到账后自动刷新'
                        : '跳转收银台完成支付'}
                  </div>
                </div>
                {active && <CheckCircle2 size={17} className="co-pay-check" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** 支付方式图标：暂不依赖外链品牌资源，按可见方式取短名。 */
function providerIcon(provider: PaymentProviderInfo): string {
  if (provider.id === 'alipay') return '支';
  if (provider.id === 'wechat') return '微';
  return '沙';
}
