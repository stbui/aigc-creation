import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import type { PaymentIntent } from '../../types/api';

/**
 * 支付方式卡。
 *
 * 沙箱身份必须明示: 当前默认只有沙箱通道, 不产生真实扣款 ——
 * 支付方式卡片内常驻声明, 不做「看起来像真支付」的蒙混,
 * 否则截图外流会被误认为已接通支付。预下单返回真实通道后才改成真实口径。
 */
export function CheckoutPaymentMethodCard({ onlineIntent }: { onlineIntent: PaymentIntent | null }) {
  return (
    <section className="co-card">
      <div className="co-card-head">
        <h2>支付方式</h2>
      </div>
      {/*
       * `PAYMENT_PROVIDER` 未配置或未填凭据时保持沙箱, 页面如实标注;
       * 配置真实通道后由后端决定 mode (跳转 / 二维码)。
       */}
      <div className="co-pay-option">
        <span className="co-pay-icon">沙</span>
        <div className="co-pay-body">
          <div className="co-pay-name">在线支付</div>
          <div className="co-pay-desc">未配置真实商户号时走站内沙箱，不产生真实扣款</div>
        </div>
        <CheckCircle2 size={17} className="co-pay-check" aria-hidden />
      </div>

      <div className="co-notice">
        <AlertTriangle size={14} aria-hidden />
        <span>
          {onlineIntent && !onlineIntent.sandbox ? (
            <>
              <strong>真实支付通道。</strong>
              请按渠道页面提示完成支付，扣款以渠道结果为准；支付结果稍后同步到本页。
            </>
          ) : onlineIntent?.sandbox ? (
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
