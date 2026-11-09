import { Link } from 'react-router-dom';
import type { MarketingQuote, MembershipPlan, Order } from '../../types/api';
import type { PaymentIntent } from '../../types/payment';
import { COUPON_MAX_LENGTH, IS_PROD } from './constants';
import { formatYuan } from './utils';

/**
 * 订单金额侧栏。
 *
 * 三层金额兜底: 已建单以**订单快照**为准 → 未建单用试算 → 试算未回时用商品原价。
 * 界面永远有数可显示，但绝不会在已下单后显示与服务端不一致的金额。
 *
 * 券码输入只在「未建单、非会员单」时出现: 金额与优惠已定死在订单上，
 * 再改就不是同一笔了；会员单不参与券与折扣。
 */
export function CheckoutAmountCard({
  order,
  plan,
  quotePreview,
  quoteError,
  couponCode,
  onCouponChange,
  subtotalCents,
  payAmount,
  memberDiscountCents,
  couponDiscountCents,
  qrDataUrl,
  paying,
  refreshingPayment,
  error,
  paymentStatusNotice,
  payBlockedReason,
  onlineIntent,
  onPayOnline,
  onCancelQr,
  onSandboxPay,
  onRefreshPayment,
}: {
  order: Order | null;
  plan: MembershipPlan | null;
  quotePreview: MarketingQuote | null;
  quoteError: string | null;
  couponCode: string;
  onCouponChange: (value: string) => void;
  subtotalCents: number;
  payAmount: number;
  /** 会员加油包折扣 */
  memberDiscountCents: number;
  /** 券 / 活动优惠 */
  couponDiscountCents: number;
  qrDataUrl: string | null;
  paying: boolean;
  refreshingPayment: boolean;
  error: string | null;
  /** 主动查单后仍待支付时的中性提示，不伪装成错误 */
  paymentStatusNotice: string | null;
  /** 非空表示当前订单不可支付（已支付 / 已取消 / 已过期） */
  payBlockedReason: string | null;
  onlineIntent: PaymentIntent | null;
  onPayOnline: () => void;
  onCancelQr: () => void;
  onSandboxPay: (scenario: 'success' | 'failed' | 'timeout') => void;
  onRefreshPayment: () => void;
}) {
  return (
    <aside className="co-side">
      <div className="co-side-card">
        <h2 className="co-side-title">订单金额</h2>

        {/*
          券码: 后端对不可用的券降级为不打折而非拒单, 原因随订单返回。
          续付既有订单时不显示 —— 金额与优惠已在那张单上定死, 再改就不是同一笔了。
          会员单不参与券与折扣 (后端会忽略), 因此整块隐藏。
        */}
        {!order && !plan && (
          <label className="co-coupon">
            <span>优惠码</span>
            <input
              placeholder="选填，提交后自动核算"
              value={couponCode}
              onChange={(e) => onCouponChange(e.target.value)}
              maxLength={COUPON_MAX_LENGTH}
            />
          </label>
        )}

        {!order && !plan && quoteError && (
          <p className="co-hint is-error" role="alert">
            {quoteError}
          </p>
        )}

        {order?.couponWarning && (
          <p className="co-hint is-error">优惠码不可用：{order.couponWarning}</p>
        )}

        {/*
          下单前的优惠试算说明。只在下单前展示 —— 下单后优惠已定死在订单快照里,
          再显示试算结果会让两组数字并存, 用户无从判断以哪个为准。
        */}
        {!order && !plan && quotePreview && (
          <>
            {quotePreview.appliedSource === 'coupon' && quotePreview.appliedCouponCode && (
              <p className="co-hint">已使用优惠码 {quotePreview.appliedCouponCode}</p>
            )}
            {quotePreview.appliedSource === 'campaign' && (
              <p className="co-hint">已命中限时活动，优惠金额已计入应付</p>
            )}
            {quotePreview.notStackedNotice && (
              <p className="co-hint">{quotePreview.notStackedNotice}</p>
            )}
            {/*
              只有「填了券码、且一分钱优惠都没拿到」才算不可用。
              命中活动时 appliedCouponCode 同样为空, 但优惠确实生效了,
              此时提示"优惠码不可用"会误导用户。
            */}
            {couponCode.trim() &&
              !quotePreview.appliedCouponCode &&
              quotePreview.discountCents === 0 && (
                <p className="co-hint is-error">该优惠码不可用或不满足使用条件</p>
              )}
          </>
        )}

        <div className="co-total">
          <span>应付金额</span>
          <strong>{payAmount <= 0 ? '免费' : formatYuan(payAmount)}</strong>
        </div>
        {(memberDiscountCents > 0 || couponDiscountCents > 0) && (
          <div className="co-sub">
            <span>原价 {formatYuan(subtotalCents)}</span>
            {memberDiscountCents > 0 && (
              <span>会员优惠 -{formatYuan(memberDiscountCents)}</span>
            )}
            {couponDiscountCents > 0 && (
              <span>券/活动优惠 -{formatYuan(couponDiscountCents)}</span>
            )}
          </div>
        )}

        {/*
          二维码态: 微信 Native 支付。轮询在页面的 startPolling 里, 到账后自动跳结果页 ——
          用户扫完码不需要再点任何按钮。
        */}
        {payBlockedReason ? (
          <div className="co-blocked">
            <p className="co-hint is-error" role="status">
              {payBlockedReason}
            </p>
            <Link className="co-btn" to="/packages">
              返回积分商城
            </Link>
          </div>
        ) : qrDataUrl ? (
          <div className="co-qr">
            <img src={qrDataUrl} alt="支付二维码" width={210} height={210} />
            <p className="co-hint">
              {onlineIntent?.schemeUrl
                ? '若未自动打开支付宝 App，请扫描下方二维码完成支付；完成后本页会自动刷新结果'
                : '请使用对应渠道扫码支付，完成后本页会自动刷新结果'}
            </p>
            <div className="co-pay-secondary-actions">
              {onlineIntent?.schemeUrl && (
                <a className="co-btn" href={onlineIntent.schemeUrl}>
                  重新打开支付宝
                </a>
              )}
              <button
                type="button"
                className="co-btn is-primary"
                disabled={refreshingPayment}
                onClick={onRefreshPayment}
              >
                {refreshingPayment ? '查询中…' : '我已完成支付，刷新状态'}
              </button>
              <button type="button" className="co-btn" onClick={onCancelQr}>
                取消扫码
              </button>
            </div>
          </div>
        ) : (
          <>
            <button type="button" className="co-pay-btn" disabled={paying} onClick={onPayOnline}>
              {paying ? '处理中…' : payAmount <= 0 ? '免费领取' : `确认支付 ${formatYuan(payAmount)}`}
            </button>
            {order && (
              <button
                type="button"
                className="co-refresh-payment"
                disabled={refreshingPayment || paying}
                onClick={onRefreshPayment}
              >
                {refreshingPayment ? '正在向渠道查询…' : '我已完成支付，刷新状态'}
              </button>
            )}
          </>
        )}

        {/*
         * 沙箱三态演示。保留失败/超时两个入口是刻意的 ——
         * 只让点成功就等于没做失败路径的验证, 真实通道接入后
         * 回调重复/超时这些分支会第一次被跑到, 那时才发现问题就晚了。
         * 且只在开发/测试环境、且确实是沙箱通道时出现: 生产环境该端点
         * 本身已按 404 处理 (见 OrderService.sandboxPay), 继续渲染按钮
         * 只会让用户点到一个「订单不存在」。
         */}
        {!payBlockedReason && !IS_PROD && (!onlineIntent || onlineIntent.sandbox) && (
          <div className="co-sandbox">
            <span className="co-sandbox-label">沙箱联调</span>
            <div className="co-sandbox-actions">
              <button
                type="button"
                className="co-sandbox-btn"
                disabled={paying}
                onClick={() => onSandboxPay('failed')}
              >
                模拟支付失败
              </button>
              <button
                type="button"
                className="co-sandbox-btn"
                disabled={paying}
                onClick={() => onSandboxPay('timeout')}
              >
                模拟支付超时
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="co-hint is-error" role="alert">
            {error}
          </p>
        )}

        {paymentStatusNotice && !error && (
          <p className="co-hint" role="status">
            {paymentStatusNotice}
          </p>
        )}

        <p className="co-side-note">
          {plan
            ? '支付成功后系统会自动发放会员权益，发放进度可在「我的订单」查看。'
            : '积分即时到账，可在「积分明细」查看发放记录。'}
        </p>
      </div>
    </aside>
  );
}
