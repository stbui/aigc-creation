import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react';
import QRCode from 'qrcode';
// quote (结算试算) 属于 C 端接口, 在 myMarketingApi 上; marketingApi 是后台优惠券管理
import {
  ApiError,
  productsApi,
  ordersApi,
  creditsApi,
  membershipApi,
  paymentsApi,
  myMarketingApi,
} from '../lib/api';
import type {
  Product,
  Order,
  CreditBalance,
  MembershipPlan,
  PaymentIntent,
  MarketingQuote,
} from '../types/api';
import { notifyCreditsChanged } from '../context/CreditsContext';
import { IS_PROD } from '../lib/constants';
import { StateError, StateSkeleton } from '../components/StateViews';

/**
 * 结算页: 下单确认 → 沙箱支付 → 结果。
 *
 * 三个必须做对的地方:
 *
 * 1. **幂等键用 ref 持有**: 同一笔下单的重试 (网络抖动、用户重复点)
 *    必须复用同一个 key, 否则后端会当成两笔新订单各扣一次钱。
 *    用 useState 会在重渲染后拿到新值, 所以用 ref。
 *
 * 2. **沙箱身份明示**: 当前只有沙箱通道, 不产生真实扣款。页面顶部常驻声明,
 *    不做「看起来像真支付」的蒙混 —— 否则截图外流会被误认为已接通支付。
 *
 * 3. **结果如实展示**: 失败/超时都把后端给的 message 原样透出,
 *    不粉饰成「稍后再试」这类模糊话术。
 */

type Phase = 'confirm' | 'result';

interface ResultView {
  kind: 'success' | 'failed' | 'timeout';
  title: string;
  desc: string;
  order: Order;
  /** 支付成功后回查到的最新余额 */
  balance: CreditBalance | null;
}

function formatYuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

/** 幂等键。crypto.randomUUID 在非安全上下文 (http) 下可能缺失, 故留兜底 */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function CheckoutPage() {
  const { sku = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();

  /**
   * 从「我的订单 → 继续支付」进来时携带 orderId。
   *
   * 必须复用**既有订单**而不是新建 —— 否则同一笔购买会出现两张 pending 单,
   * 用户付了其中一张, 另一张还挂着, 后续可能被误认为欠款。
   */
  const resumeOrderId = search.get('orderId');

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
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [phase, setPhase] = useState<Phase>('confirm');
  const [result, setResult] = useState<ResultView | null>(null);
  /** 真实通道的预下单结果 (微信二维码 / 支付宝跳转) */
  const [onlineIntent, setOnlineIntent] = useState<PaymentIntent | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
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
  const pollRef = useRef<number | null>(null);

  /**
   * ⚠ 必须用 ref 而非 state: 重渲染会让 state 拿到新 key,
   * 而幂等的前提是「同一次下单的所有重试用同一个 key」。
   */
  const idemKeyRef = useRef<string>(newIdempotencyKey());

  useEffect(() => {
    let alive = true;
    setLoading(true);

    const loadPlan = async (id: string) => {
      const plans = await membershipApi.plans();
      const found = plans.find((p) => p.id === id || p.code === id);
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
          // 会员单没有 OrderItem, 套餐信息在 order.membershipPlanId 上
          if (o.membershipPlanId) {
            await loadPlan(o.membershipPlanId);
            return;
          }
          const item = o.items?.[0];
          if (!item) throw new Error('订单无商品明细');
          const p = await productsApi.detail(item.sku);
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
  }, [sku, resumeOrderId, isMembership, planId]);

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
          const status = e instanceof ApiError ? e.status : 0;
          const message = e instanceof Error ? e.message : '';
          setQuoteError(
            status >= 400 && status < 500
              ? `优惠码不可用：${message || '券码不存在或已失效'}`
              : '优惠试算失败，当前按原价结算',
          );
        });
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [order, plan, product, couponCode]);

  /** 下单。重复调用复用同一 key, 后端返回同一订单 */
  const placeOrder = useCallback(async (): Promise<Order> => {
    if (!product && !plan) throw new Error('商品未加载');
    if (order) return order; // 已建过单, 不重复建

    const created = await ordersApi.create({
      ...(plan
        ? {
            membershipPlanId: plan.id,
            // 会员单不接受券: 传了会被后端忽略并在 couponWarning 里说明,
            // 这里干脆不传, 免得用户以为折扣生效了
          }
        : {
            productId: product!.id,
            quantity: 1,
            couponCode: couponCode.trim() || undefined,
          }),
      idempotencyKey: idemKeyRef.current,
    });
    setOrder(created);
    return created;
  }, [product, plan, order, couponCode]);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // 组件卸载时务必停掉轮询 —— 否则离开页面后仍在打接口, 且会在已卸载组件上 setState
  useEffect(() => stopPolling, [stopPolling]);

  /**
   * 轮询支付结果。
   *
   * 真实通道到账是**渠道回调**驱动的, 前端没有任何办法「知道」支付完成,
   * 只能问后端。5 分钟上限与订单过期时间一致: 超过之后即使到账,
   * 订单也已经不该被当作有效支付, 用户需要去订单页确认。
   */
  const startPolling = useCallback(
    (orderId: string) => {
      stopPolling();
      const startedAt = Date.now();
      pollRef.current = window.setInterval(async () => {
        if (Date.now() - startedAt > 5 * 60 * 1000) {
          stopPolling();
          setError('支付确认超时。若已扣款，请稍后在「我的订单」查看状态');
          return;
        }
        try {
          const st = await paymentsApi.status(orderId);
          if (st.status !== 'paid') return;
          stopPolling();
          const fresh = await ordersApi.detail(orderId);
          setOrder(fresh);
          notifyCreditsChanged();
          let balance: CreditBalance | null = null;
          try {
            balance = await creditsApi.balance();
          } catch {
            /* 余额回查失败不阻断结果展示 */
          }
          setResult({
            kind: 'success',
            title: '支付成功',
            desc: fresh.grantedCredits > 0 ? `${fresh.grantedCredits} 积分已到账` : '权益已生效',
            order: fresh,
            balance,
          });
          setPhase('result');
        } catch {
          // 单次轮询失败 (网络抖动) 不应该中断, 下一轮继续
        }
      }, 2000);
    },
    [stopPolling],
  );

  /**
   * 真实通道支付。
   *
   * 三种 mode 的处理:
   *   sandbox  → 当前环境没配真实通道, 如实走站内模拟 (并保留沙箱声明)
   *   redirect → 直接跳渠道收银台 (支付宝网页支付)
   *   qrcode   → 渲染二维码并开始轮询 (微信 Native)
   */
  const payOnline = async () => {
    setPaying(true);
    setError(null);
    try {
      const o = order ?? (await placeOrder());
      const intent = await paymentsApi.intent(o.id);

      /*
       * 0 元单（免费体验包 / 100% 优惠）：后端在 createIntent 里已经直接入账，
       * 这里只负责把结果拿到并刷新余额。此前后端对 0 元单直接报错，
       * 「免费领取」是一条永远走不通的路。
       */
      if (intent.mode === 'free') {
        const fresh = await ordersApi.detail(o.id);
        setOrder(fresh);
        notifyCreditsChanged();
        let balance: CreditBalance | null = null;
        try {
          balance = await creditsApi.balance();
        } catch {
          /* 余额回查失败不阻断结果展示 */
        }
        setResult({
          kind: 'success',
          title: '领取成功',
          desc:
            fresh.grantedCredits > 0
              ? `${fresh.grantedCredits} 积分已到账`
              : '订单已完成',
          order: fresh,
          balance,
        });
        setPhase('result');
        return;
      }

      if (intent.mode === 'sandbox') {
        await pay('success');
        return;
      }
      if (intent.mode === 'redirect' && intent.payUrl) {
        window.location.href = intent.payUrl;
        return;
      }
      if (intent.mode === 'qrcode' && intent.codeUrl) {
        const dataUrl = await QRCode.toDataURL(intent.codeUrl, { width: 220, margin: 1 });
        setQrDataUrl(dataUrl);
        setOnlineIntent(intent);
        startPolling(o.id);
        return;
      }
      setError('支付通道返回了无法识别的方式，请联系客服');
    } catch (e) {
      setError((e as Error).message || '发起支付失败');
    } finally {
      setPaying(false);
    }
  };

  /**
   * 沙箱支付三态演示。
   *
   * ⚠ `failed` 场景订单仍为 pending (可重试), 因此**不能**转结果页终态 ——
   * 用户要能直接再点一次成功。timeout 才是终态 (订单已 cancelled)。
   */
  const pay = async (scenario: 'success' | 'failed' | 'timeout') => {
    setPaying(true);
    setError(null);
    try {
      const o = order ?? (await placeOrder());
      const res = await ordersApi.sandboxPay(o.id, scenario);
      const paid = res.order;
      setOrder(paid);

      if (scenario === 'failed') {
        // 保持确认页, 让用户可以改场景重试
        setError(res.message || '支付失败，可重新发起支付');
        return;
      }

      let balance: CreditBalance | null = null;
      try {
        balance = await creditsApi.balance();
      } catch {
        // 余额回查失败不阻断结果展示 —— 支付结果本身已落库, 余额可去明细页看
      }
      // 通知顶导刷新 (发积分已发生)。支付成功与超时都要通知:
      // 超时虽然没发积分, 但订单状态变了, 用户可能从别处进来看到旧数据
      notifyCreditsChanged();

      if (scenario === 'success') {
        setResult({
          kind: 'success',
          title: '支付成功',
          desc: `${paid.grantedCredits} 积分已到账`,
          order: paid,
          balance,
        });
      } else {
        setResult({
          kind: 'timeout',
          title: '支付超时',
          desc: '订单已关闭，未产生扣款',
          order: paid,
          balance,
        });
      }
      setPhase('result');
    } catch (e) {
      setError((e as Error).message || '支付失败');
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="pkg-checkout-page">
        <div className="pkg-checkout-container">
          {/* 2026-10-20: 原为纯文本「正在加载…」—— 慢网下与"空页面"难以区分 */}
          <StateSkeleton variant="panel" count={3} />
        </div>
      </div>
    );
  }

  if (!product && !plan) {
    return (
      <div className="pkg-checkout-page">
        <div className="pkg-checkout-container">
          {/*
            失败态: 原复用 `.pkg-sandbox-notice` —— 那个 class 语义是"沙箱支付说明",
            拿来渲染"商品加载失败"会把环境说明和错误混在同一视觉里。
          */}
          <StateError
            title="商品信息加载失败"
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
    const Icon =
      result.kind === 'success' ? CheckCircle2 : result.kind === 'timeout' ? Clock : XCircle;
    return (
      <div className="pkg-checkout-page">
        <div className="pkg-checkout-container">
          <div className="pkg-result-card">
            <div className={`pkg-result-icon is-${result.kind}`}>
              <Icon size={28} />
            </div>
            <h2 className="pkg-result-title">{result.title}</h2>
            <p className="pkg-result-desc">{result.desc}</p>

            <div className="pkg-result-detail">
              <div className="pkg-result-row">
                <span>订单号</span>
                <strong>{result.order.orderNo}</strong>
              </div>
              <div className="pkg-result-row">
                <span>实付金额</span>
                <strong>{formatYuan(result.order.paidCents)}</strong>
              </div>
              {result.order.grantedCredits > 0 && (
                <div className="pkg-result-row">
                  <span>获得积分</span>
                  <strong>{result.order.grantedCredits}</strong>
                </div>
              )}
              {result.balance && (
                <div className="pkg-result-row">
                  <span>当前余额</span>
                  <strong>{result.balance.balance}</strong>
                </div>
              )}
              {result.balance && result.balance.expiringSoon > 0 && (
                <div className="pkg-result-row">
                  <span>30 天内到期</span>
                  <strong>{result.balance.expiringSoon}</strong>
                </div>
              )}
              {result.order.discountCents > 0 && (
                <div className="pkg-result-row">
                  <span>优惠减免</span>
                  <strong>-{formatYuan(result.order.discountCents)}</strong>
                </div>
              )}
            </div>

            <div className="pkg-result-actions">
              <button
                type="button"
                className="pkg-result-btn"
                onClick={() => navigate('/orders')}
              >
                我的订单
              </button>
              <button
                type="button"
                className="pkg-result-btn is-primary"
                onClick={() => navigate(plan ? '/' : '/packages')}
              >
                {plan ? '返回首页' : '继续购买'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 确认 + 支付态 ───────────────────────────────────────────────────
  const item = order?.items?.[0];
  const unitCents = product?.priceCents ?? plan!.priceCents;
  /*
   * 金额口径: 已建单以**订单快照**为准（服务端定死的数），未建单用试算结果，
   * 试算还没回来时退回商品原价。三层兜底保证界面永远有数可显示，
   * 但绝不会在已下单后显示一个与服务端不一致的金额。
   */
  const subtotalCents = order ? item?.priceCents ?? unitCents : quotePreview?.subtotalCents ?? unitCents;
  const payAmount = order?.paidCents ?? quotePreview?.payableCents ?? unitCents;
  const discount = order?.discountCents ?? quotePreview?.discountCents ?? 0;
  const title = plan ? '确认订阅' : '确认订单';

  return (
    <div className="pkg-checkout-page">
      <div className="pkg-checkout-container">
        <button type="button" className="pkg-back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> 返回
        </button>

        <div className="pkg-confirm-card">
          <h2 className="pkg-confirm-title">{title}</h2>
          <p className="pkg-confirm-sub">
            {plan
              ? `${plan.durationDays} 天有效 · 每月 ${plan.monthlyCredits} 积分`
              : product!.creditsValidDays > 0
                ? `获得积分 ${product!.creditsValidDays} 天内有效`
                : '获得积分永久有效'}
          </p>

          <div className="pkg-confirm-row">
            <span>{plan ? '套餐' : '商品'}</span>
            <strong>{plan ? plan.name : product!.name}</strong>
          </div>
          <div className="pkg-confirm-row">
            <span>数量</span>
            <strong>1</strong>
          </div>
          {/*
            会员单展示的是「权益口径」而非积分: 月度积分按月发放, 与一次性
            积分包的「立刻到账 N 积分」不是同一件事, 写成「获得积分」会误导。
          */}
          {plan ? (
            <>
              <div className="pkg-confirm-row">
                <span>会员周期</span>
                <strong>{plan.durationDays} 天</strong>
              </div>
              <div className="pkg-confirm-row">
                <span>月度积分</span>
                <strong>{plan.monthlyCredits} 积分</strong>
              </div>
            </>
          ) : (
            <div className="pkg-confirm-row">
              <span>获得积分</span>
              <strong>{product!.credits} 积分</strong>
            </div>
          )}

          {/* 券码: 后端对不可用的券降级为不打折而非拒单, 原因随订单返回。
              续付既有订单时不显示 —— 金额与优惠已在那张单上定死, 再改就不是同一笔了。
              会员单不参与券与折扣 (后端会忽略), 因此整块隐藏。 */}
          {!order && !plan && (
            <div className="pkg-confirm-row">
              <span>优惠码</span>
              <input
                className="pkg-sandbox-btn"
                style={{ maxWidth: 160, padding: '6px 10px' }}
                placeholder="选填"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                maxLength={24}
              />
            </div>
          )}

          {!order && !plan && quoteError && (
            <p className="pkg-pay-hint" role="alert" style={{ textAlign: 'left', color: '#a32d2d' }}>
              {quoteError}
            </p>
          )}

          {order?.couponWarning && (
            <p className="pkg-pay-hint" style={{ textAlign: 'left', color: '#a32d2d' }}>
              优惠码不可用：{order.couponWarning}
            </p>
          )}

          {/*
            下单前的优惠试算说明。只在下单前展示 —— 下单后优惠已定死在订单快照里,
            再显示试算结果会让两组数字并存, 用户无从判断以哪个为准。
          */}
          {!order && !plan && quotePreview && (
            <>
              {quotePreview.appliedSource === 'coupon' && quotePreview.appliedCouponCode && (
                <p className="pkg-pay-hint" style={{ textAlign: 'left' }}>
                  已使用优惠码 {quotePreview.appliedCouponCode}
                </p>
              )}
              {quotePreview.appliedSource === 'campaign' && (
                <p className="pkg-pay-hint" style={{ textAlign: 'left' }}>
                  已命中限时活动，优惠金额已计入应付
                </p>
              )}
              {quotePreview.notStackedNotice && (
                <p className="pkg-pay-hint" style={{ textAlign: 'left' }}>
                  {quotePreview.notStackedNotice}
                </p>
              )}
              {/*
                只有「填了券码、且一分钱优惠都没拿到」才算不可用。
                命中活动时 appliedCouponCode 同样为空, 但优惠确实生效了,
                此时提示"优惠码不可用"会误导用户。
              */}
              {couponCode.trim() && !quotePreview.appliedCouponCode && quotePreview.discountCents === 0 && (
                <p className="pkg-pay-hint" style={{ textAlign: 'left', color: '#a32d2d' }}>
                  该优惠码不可用或不满足使用条件
                </p>
              )}
            </>
          )}

          <div className="pkg-confirm-row pkg-confirm-total">
            <span>应付金额</span>
            <strong>{payAmount <= 0 ? '免费' : formatYuan(payAmount)}</strong>
          </div>
          {discount > 0 && (
            <div className="pkg-confirm-offline">
              <span>原价 {formatYuan(subtotalCents)}</span>
              <span>已优惠 -{formatYuan(discount)}</span>
            </div>
          )}
        </div>

        <div className="pkg-confirm-card">
          <h3 className="pkg-payment-title">支付方式</h3>
          <div className="pkg-payment-options">
            {/*
             * 渠道配色沿用参考站实拍 (支付宝 #009FE8 / 微信 #24B340)。
             * `PAYMENT_PROVIDER` 未配置或未填凭据时保持沙箱, 页面如实标注;
             * 配置真实通道后由后端决定 mode (跳转 / 二维码)。
             */}
            <div className="pkg-payment-option is-active">
              <span className="pkg-payment-icon is-sandbox">沙</span>
              <div className="pkg-payment-body">
                <div className="pkg-payment-name">在线支付</div>
                <div className="pkg-payment-desc">
                  未配置真实商户号时走站内沙箱，不产生真实扣款
                </div>
              </div>
            </div>
          </div>

          {/*
            二维码态: 微信 Native 支付。轮询在 startPolling 里, 到账后自动跳结果页 ——
            用户扫完码不需要再点任何按钮。
          */}
          {qrDataUrl ? (
            <div className="pkg-sandbox-actions" style={{ flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <img src={qrDataUrl} alt="微信支付二维码" width={220} height={220} />
              <p className="pkg-pay-hint">请使用微信扫码支付，完成后本页会自动刷新结果</p>
              <button
                type="button"
                className="pkg-sandbox-btn"
                onClick={() => {
                  stopPolling();
                  setQrDataUrl(null);
                  setOnlineIntent(null);
                }}
              >
                取消扫码
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="pkg-pay-btn"
              disabled={paying}
              onClick={() => void payOnline()}
            >
              {paying ? '处理中…' : payAmount <= 0 ? '免费领取' : `确认支付 ${formatYuan(payAmount)}`}
            </button>
          )}

          {/*
           * 沙箱三态演示。保留失败/超时两个入口是刻意的 ——
           * 只让点成功就等于没做失败路径的验证, 真实通道接入后
           * 回调重复/超时这些分支会第一次被跑到, 那时才发现问题就晚了。
           */}
          {/*
           * 沙箱三态演示只在开发/测试环境出现，且只在确实是沙箱通道时出现。
           * 生产环境该端点本身已按 404 处理（见 OrderService.sandboxPay），
           * 继续渲染按钮只会让用户点到一个「订单不存在」。
           */}
          {!IS_PROD && (!onlineIntent || onlineIntent.sandbox) && (
            <div className="pkg-sandbox-actions">
              <button
                type="button"
                className="pkg-sandbox-btn"
                disabled={paying}
                onClick={() => void pay('failed')}
              >
                模拟支付失败
              </button>
              <button
                type="button"
                className="pkg-sandbox-btn"
                disabled={paying}
                onClick={() => void pay('timeout')}
              >
                模拟支付超时
              </button>
            </div>
          )}

          <div className="pkg-sandbox-notice">
            <AlertTriangle size={14} />
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
                  <strong>未配置真实商户号时走站内沙箱，不产生真实扣款</strong>；配置
                  <code>PAYMENT_PROVIDER</code> 与商户凭据后由支付宝/微信完成真实扣款。
                </>
              )}
            </span>
          </div>

          {error && (
            <p className="pkg-pay-hint" style={{ color: '#a32d2d' }}>
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
