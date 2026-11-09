import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { QUOTE_DEBOUNCE_MS } from './constants';
import { StateError, StateSkeleton } from './components';
import { membershipApi, myMarketingApi, ordersApi, productsApi } from './api';
import { blockedReasonOf, quoteErrorMessageOf } from './utils';
import { useCheckoutPayment } from './hooks';
import { CheckoutAmountCard } from './CheckoutAmountCard';
import { CheckoutHelpCard } from './CheckoutHelpCard';
import { CheckoutOrderCard } from './CheckoutOrderCard';
import { CheckoutPaymentMethodCard } from './CheckoutPaymentMethodCard';
import { CheckoutResultCard } from './CheckoutResultCard';
import type { MarketingQuote, MembershipPlan, Product } from '../../types/api';
import { useAuth } from '../../context/AuthContext';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';

/**
 * 结算页: 下单确认 → 沙箱支付 → 结果。
 *
 * 三个必须做对的地方:
 *
 * 1. **幂等键用 ref 持有**: 同一笔下单的重试 (网络抖动、用户重复点)
 *    必须复用同一个 key, 否则后端会当成两笔新订单各扣一次钱。
 *    用 useState 会在重渲染后拿到新值, 所以用 ref。
 *
 * 2. **沙箱身份明示**: 当前只有沙箱通道, 不产生真实扣款。支付方式卡片内常驻声明,
 *    不做「看起来像真支付」的蒙混 —— 否则截图外流会被误认为已接通支付。
 *
 * 3. **结果如实展示**: 失败/超时都把后端给的 message 原样透出,
 *    不粉饰成「稍后再试」这类模糊话术。
 */

export function CheckoutPage() {
  useDocumentMeta('确认订单 · 货觉AI', '确认商品与支付方式，完成积分或会员购买。');
  const { sku = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { token } = useAuth();

  /**
   * 从「我的订单 → 继续支付」进来时携带 orderId。
   *
   * 必须复用**既有订单**而不是新建 —— 否则同一笔购买会出现两张 pending 单,
   * 用户付了其中一张, 另一张还挂着, 后续可能被误认为欠款。
   */
  const resumeOrderId = search.get('orderId');
  /** 渠道收银台回跳标记：本页会自动主动查一次，不等异步通知。 */
  const paymentReturnRequested = search.get('paymentReturn') === '1';

  /**
   * 会员订阅结算 (`/checkout/membership?planId=...`)。
   *
   * 与积分包的差别不只是价格: 会员单没有 OrderItem、不叠加券与折扣,
   * 支付成功后由后端激活权益 —— 所以这里只负责把套餐信息如实展示出来。
   */
  const planId = search.get('planId');
  const isMembership = Boolean(planId) || search.get('type') === 'membership';


  const [product, setProduct] = useState<Product | null>(null);
  const [plan, setPlan] = useState<MembershipPlan | null>(null);
  const [loading, setLoading] = useState(true);

  const [couponCode, setCouponCode] = useState('');

  /**
   * 结算试算（券 / 限时活动）。
   *
   * 只在**还没建单**时试算：一旦下单，金额与优惠以订单快照为准，
   * 继续试算会让界面显示一个与服务端实际扣款不一致的数字。
   * 试算不落库、不占幂等键，可以随输入反复调。
   */
  const [quotePreview, setQuotePreview] = useState<MarketingQuote | null>(null);
  /**
   * 券码试算失败的原因。
   *
   * 试算失败时 `quotePreview` 会被置空，原先依赖 quotePreview 的提示块也随之消失，
   * 用户输入不存在的券码时页面没有任何反馈。这里单独保存失败文案，
   * 与「试算成功但券未生效」的提示分开。
   */
  const [quoteError, setQuoteError] = useState<string | null>(null);

  /**
   * 渠道回跳后的自动查单只对同一订单执行一次。
   *
   * React StrictMode 会重复执行 mount effect；若没有守卫，一次回跳会向渠道
   * 连发两次强制查单。用户手动刷新不受此限制，仍可随时再次查单。
   */
  const autoQueriedOrderRef = useRef<string | null>(null);

  /*
   * 支付状态机（下单 / 发起渠道支付 / 轮询到账 / 主动查单 / 收尾切结果页）在
   * `useCheckoutPayment` 里 —— 页面只拿结果来渲染，不再持有那 8 个支付态与
   * 3 个 ref。商品、套餐与续付订单的加载留在下方 effect，因为那是「结算对象」。
   */
  const {
    order,
    setOrder,
    paying,
    error,
    setError,
    phase,
    result,
    onlineIntent,
    qrDataUrl,
    setQrDataUrl,
    setOnlineIntent,
    refreshingPayment,
    paymentStatusNotice,
    providers,
    selectedProviderId,
    setSelectedProviderId,
    providersLoading,
    providersError,
    helpImage,
    helpText,
    stopPolling,
    refreshPaymentStatus,
    payOnline,
    pay,
  } = useCheckoutPayment({ product, plan, couponCode, token });

  useEffect(() => {
    let alive = true;
    setLoading(true);

    const loadPlan = async (id: string) => {
      const plans = await membershipApi.plans();
      // 公开列表只有 active；续付已下架套餐时回退到单套餐接口
      const found =
        plans.find((p) => p.id === id || p.code === id) ??
        (await membershipApi.plan(id).catch(() => null));
      if (!found) throw new Error('会员套餐不存在或已下架');
      if (alive) setPlan(found);
    };

    // 续付路径: 先拉既有订单, 金额与优惠以它为准, 不重新下单
    if (resumeOrderId) {
      ordersApi
        .detail(resumeOrderId)
        .then(async (o) => {
          if (!alive) return;
          setOrder(o);
          // 从渠道收银台返回时，异步通知可能尚未到达；立即主动查一次渠道。
          if (token && paymentReturnRequested && autoQueriedOrderRef.current !== o.id) {
            autoQueriedOrderRef.current = o.id;
            void refreshPaymentStatus(o.id, true);
          }
          // 会员单没有 OrderItem, 套餐信息在 order.membershipPlanId 上
          if (o.membershipPlanId) {
            await loadPlan(o.membershipPlanId);
            return;
          }
          const item = o.items?.[0];
          if (!item) throw new Error('订单无商品明细');
          /*
           * 订单快照本身就是可支付依据。商品下架/改价后仍要能续付，
           * 因此 detail 失败时用订单快照构造展示对象，而不是整页报错。
           */
          const snapshotProduct: Product = {
            id: item.productId,
            sku: item.sku,
            name: item.name,
            description: '',
            priceCents: item.priceCents,
            originalPriceCents: null,
            credits: item.credits,
            creditsValidDays: item.validDays,
            type: 'credits',
            isFree: item.priceCents === 0,
          };
          const p = await productsApi.detail(item.sku).catch(() => snapshotProduct);
          if (alive) setProduct(p);
        })
        .catch((e: Error) => {
          if (alive) setError(e.message || '订单加载失败');
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
      return () => {
        alive = false;
      };
    }

    // 会员订阅: 套餐来自 /membership/plans, 不经过商品接口
    if (isMembership) {
      if (!planId) {
        setError('缺少套餐参数，请从会员页重新进入');
        setLoading(false);
        return () => {
          alive = false;
        };
      }
      loadPlan(planId)
        .catch((e: Error) => {
          if (alive) setError(e.message || '套餐加载失败');
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
      return () => {
        alive = false;
      };
    }

    productsApi
      .detail(sku)
      .then((p) => {
        if (alive) setProduct(p);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message || '商品不存在');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [sku, resumeOrderId, isMembership, planId, token, refreshPaymentStatus, paymentReturnRequested]);

  /*
   * 券 / 活动试算。
   *
   * 此前结算页只显示商品原价，优惠要等下单后才由订单快照揭晓 ——
   * 用户填了券码却看不到"省了多少"，只能先下单再判断，转化与信任都受损。
   * 试算端点不落库、不建单，按输入防抖调用即可。
   */
  useEffect(() => {
    if (order || plan || !product) {
      setQuotePreview(null);
      setQuoteError(null);
      return;
    }
    // 输入变化后先清掉上一轮提示，避免防抖期间还显示旧券码的错误
    setQuoteError(null);
    let alive = true;
    const timer = window.setTimeout(() => {
      myMarketingApi
        .quote({
          productIds: [product.id],
          quantities: [1],
          couponCode: couponCode.trim() || undefined,
        })
        .then((q) => {
          if (alive) {
            setQuotePreview(q);
            setQuoteError(null);
          }
        })
        .catch((e: unknown) => {
          // 试算失败不阻断下单：以原价展示，最终金额仍以订单快照为准。
          // 但填了券时必须把失败原因告诉用户，否则用户会以为券已生效。
          if (!alive) return;
          setQuotePreview(null);
          if (!couponCode.trim()) {
            setQuoteError(null);
            return;
          }
          setQuoteError(quoteErrorMessageOf(e, couponCode));
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [order, plan, product, couponCode]);

  if (loading) {
    return (
      <div className="pkg-checkout-page">
        <div className="co-shell">
          {/* 2026-10-20: 原为纯文本「正在加载…」—— 慢网下与"空页面"难以区分 */}
          <StateSkeleton variant="panel" count={3} />
        </div>
      </div>
    );
  }

  if (!product && !plan) {
    return (
      <div className="pkg-checkout-page">
        <div className="co-shell">
          {/*
            失败态不复用支付卡的沙箱声明块 (`.co-notice`): 那个 class 的语义是
            "沙箱支付说明", 拿来渲染"商品加载失败"会把环境说明和错误混在同一视觉里。
          */}
          <StateError
            title={isMembership ? '套餐信息加载失败' : '商品信息加载失败'}
            desc={
              isMembership
                ? '没能取回该会员套餐的信息。套餐可能已下架，请回到会员页重新选择。'
                : '没能取回该商品的信息。可能是后端未启动、链接有误或商品已下架。'
            }
            detail={error ?? undefined}
            action={
              <button type="button" className="state-btn is-ghost" onClick={() => navigate('/packages')}>
                返回积分商城
              </button>
            }
          />
        </div>
      </div>
    );
  }

  // ── 结果态 ──────────────────────────────────────────────────────────
  if (phase === 'result' && result) {
    return <CheckoutResultCard result={result} plan={plan} onNavigate={navigate} />;
  }

  // ── 确认 + 支付态 ───────────────────────────────────────────────────
  const item = order?.items?.[0];
  const unitCents = product?.priceCents ?? plan!.priceCents;
  /*
   * 金额口径: 已建单以**订单快照**为准（服务端定死的数），未建单用试算结果，
   * 试算还没回来时退回商品原价。三层兜底保证界面永远有数可显示，
   * 但绝不会在已下单后显示一个与服务端不一致的金额。
   */
  const orderItemsSubtotal =
    order?.itemsSubtotalCents ??
    (order?.items?.length
      ? order.items.reduce((sum, oi) => sum + oi.priceCents * oi.quantity, 0)
      : undefined);
  const subtotalCents = order
    ? orderItemsSubtotal ?? item?.priceCents ?? unitCents
    : quotePreview?.subtotalCents ?? unitCents;
  const payAmount = order?.paidCents ?? quotePreview?.payableCents ?? unitCents;
  const memberDiscount = order
    ? order.memberDiscountCents ?? 0
    : quotePreview?.memberDiscountCents ?? 0;
  const couponDiscount = order
    ? order.discountCents
    : quotePreview?.discountCents ?? 0;
  const title = plan ? '确认订阅' : '确认订单';
  /*
   * 续付链接 / 旧标签页可能指向已支付、已取消或已过期的订单。
   * 这些状态都必须在前端先拦下，不能等用户点了支付再吃一个 409。
   */
  const payBlockedReason = order ? blockedReasonOf(order) : null;

  return (
    <div className="pkg-checkout-page">
      <button type="button" className="co-back" onClick={() => navigate(-1)}>
        <ArrowLeft size={14} aria-hidden /> 返回
      </button>

      <header className="co-head">
        <div className="co-head-title">
          <h1>{title}</h1>
          <span className="co-head-badge">{plan ? '会员订阅' : '积分包'}</span>
        </div>
        <p>
          {plan
            ? `${plan.durationDays} 天有效 · 每月 ${plan.monthlyCredits} 积分`
            : '支付完成后积分立即到账'}
        </p>
      </header>

      <div className="co-layout">
        <div className="co-main">
          <CheckoutOrderCard product={product} plan={plan} />
          <CheckoutPaymentMethodCard
            onlineIntent={onlineIntent}
            providers={providers}
            selectedProviderId={selectedProviderId}
            onSelectProvider={setSelectedProviderId}
            providersLoading={providersLoading}
            providersError={providersError}
          />
          <CheckoutHelpCard helpImage={helpImage} helpText={helpText} />
        </div>

        <CheckoutAmountCard
          order={order}
          plan={plan}
          quotePreview={quotePreview}
          quoteError={quoteError}
          couponCode={couponCode}
          onCouponChange={setCouponCode}
          subtotalCents={subtotalCents}
          payAmount={payAmount}
          memberDiscountCents={memberDiscount}
          couponDiscountCents={couponDiscount}
          qrDataUrl={qrDataUrl}
          paying={paying}
          refreshingPayment={refreshingPayment}
          error={error}
          paymentStatusNotice={paymentStatusNotice}
          payBlockedReason={payBlockedReason}
          onlineIntent={onlineIntent}
          onPayOnline={() => void payOnline()}
          onCancelQr={() => {
            stopPolling();
            setQrDataUrl(null);
            setOnlineIntent(null);
          }}
          onSandboxPay={(scenario) => void pay(scenario)}
          onRefreshPayment={() => void refreshPaymentStatus(order!.id)}
        />
      </div>
    </div>
  );
}
