import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import type { PaymentIntent, PaymentProviderInfo } from '../../types/payment';

/**
 * 支付方式卡。
 *
 * 前台固定只展示「支付宝 / 微信支付」两种方式。每种方式背后是官方渠道
 * 还是易支付由管理员选择，本组件不读取也不展示真实服务商身份。
 */
export function CheckoutPaymentMethodCard({
  onlineIntent,
  providers,
  selectedProviderId,
  onSelectProvider,
  providersLoading,
  providersError,
}: {
  onlineIntent: PaymentIntent | null;
  providers: PaymentProviderInfo[];
  selectedProviderId: string;
  onSelectProvider: (id: string) => void;
  providersLoading: boolean;
  providersError: string | null;
}) {
  const selected =
    providers.find((p) => p.id === selectedProviderId) ?? providers[0] ?? null;

  return (
    <section className="co-card">
      <div className="co-card-head">
        <h2>支付方式</h2>
      </div>

      {providersLoading && providers.length === 0 ? (
        <div className="co-pay-option is-muted">
          <span className="co-pay-icon">…</span>
          <div className="co-pay-body">
            <div className="co-pay-name">正在读取支付渠道…</div>
          </div>
        </div>
      ) : providers.length === 0 ? (
        <div className="co-pay-option is-muted">
          <span className="co-pay-icon">!</span>
          <div className="co-pay-body">
            <div className="co-pay-name">
              {providersError ? '支付方式加载失败' : '暂无可用支付方式'}
            </div>
            <div className="co-pay-desc">
              {providersError ?? '后台尚未选择可用支付来源，请联系管理员。'}
            </div>
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
                    {provider.checkoutMode === 'qrcode'
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

      <div className="co-notice">
        <AlertTriangle size={14} aria-hidden />
        <span>
          {onlineIntent ? (
            <>
              <strong>支付结果以服务商为准。</strong>
              请按收银台提示完成支付，到账后本页会自动刷新。
            </>
          ) : (
            <>
              支付来源由管理员配置；如按钮不可用，请联系管理员检查对应服务商。
            </>
          )}
        </span>
      </div>
    </section>
  );
}

/** 支付方式图标：暂不依赖外链品牌资源，按可见方式取短名。 */
function providerIcon(provider: PaymentProviderInfo): string {
  return provider.id === 'alipay' ? '支' : '微';
}
