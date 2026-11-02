import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import type { PaymentIntent, PaymentProviderInfo } from '../../types/api';

/**
 * 支付方式卡。
 *
 * 后端在可用渠道 > 1 时强制要求 `intent` 带 providerId（见
 * PaymentOrderService.createIntent）。本卡必须在发起支付前把渠道列出来，
 * 否则支付宝 + 微信同时配置时，所有非 0 元订单都会 400。
 *
 * 沙箱身份仍然明示：未配置真实商户号时走站内模拟，不产生真实扣款。
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
              {providersError ? '支付渠道加载失败' : '暂无可用支付渠道'}
            </div>
            <div className="co-pay-desc">
              {providersError ?? '后台尚未配置可用渠道，请联系管理员。'}
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
                    {provider.sandbox
                      ? '站内沙箱模拟，不产生真实扣款'
                      : provider.checkoutMode === 'qrcode'
                        ? '扫码完成支付，到账后自动刷新'
                        : '跳转渠道收银台完成支付'}
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
          {onlineIntent && !onlineIntent.sandbox ? (
            <>
              <strong>真实支付通道。</strong>
              请按渠道页面提示完成支付，扣款以渠道结果为准；支付结果稍后同步到本页。
            </>
          ) : onlineIntent?.sandbox || selected?.sandbox ? (
            <>
              <strong>沙箱环境，不产生真实扣款。</strong>
              支付在站内模拟，仅用于联调。
            </>
          ) : (
            <>
              支付方式由后台通道配置决定：
              <strong>未配置真实商户号时走站内沙箱，不产生真实扣款</strong>；配置{' '}
              <code>PAYMENT_PROVIDER</code> 与商户凭据后由支付宝/微信完成真实扣款。
            </>
          )}
        </span>
      </div>
    </section>
  );
}

/**
 * 渠道图标：真实渠道暂时没有可用的品牌资源。
 * 后端 `icon` 是 'alipay' / 'wechat' / 'sandbox' 这类标识，不是可渲染图片，
 * 直接当文字会显示成英文 slug；这里按渠道 id 取短名，不伪造 logo。
 */
function providerIcon(provider: PaymentProviderInfo): string {
  if (provider.sandbox) return '沙';
  if (provider.id === 'alipay') return '支';
  if (provider.id === 'wechat') return '微';
  return provider.name.slice(0, 1);
}
