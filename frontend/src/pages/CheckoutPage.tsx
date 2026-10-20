import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { productsApi, ordersApi, creditsApi } from '../lib/api';
import type { Product, Order, CreditBalance } from '../types/api';
import { notifyCreditsChanged } from '../context/CreditsContext';
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

  const [product, setProduct] = useState<Product | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [phase, setPhase] = useState<Phase>('confirm');
  const [result, setResult] = useState<ResultView | null>(null);

  /**
   * ⚠ 必须用 ref 而非 state: 重渲染会让 state 拿到新 key,
   * 而幂等的前提是「同一次下单的所有重试用同一个 key」。
   */
  const idemKeyRef = useRef<string>(newIdempotencyKey());

  useEffect(() => {
    let alive = true;
    setLoading(true);

    // 续付路径: 先拉既有订单, 金额与优惠以它为准, 不重新下单
    if (resumeOrderId) {
      ordersApi
        .detail(resumeOrderId)
        .then(async (o) => {
          if (!alive) return;
          setOrder(o);
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
  }, [sku, resumeOrderId]);

  /** 下单。重复调用复用同一 key, 后端返回同一订单 */
  const placeOrder = useCallback(async (): Promise<Order> => {
    if (!product) throw new Error('商品未加载');
    if (order) return order; // 已建过单, 不重复建

    const created = await ordersApi.create({
      productId: product.id,
      quantity: 1,
      idempotencyKey: idemKeyRef.current,
      couponCode: couponCode.trim() || undefined,
    });
    setOrder(created);
    return created;
  }, [product, order, couponCode]);

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

  if (!product) {
    return (
      <div className="pkg-checkout-page">
        <div className="pkg-checkout-container">
          {/*
            失败态: 原复用 `.pkg-sandbox-notice` —— 那个 class 语义是"沙箱支付说明",
            拿来渲染"商品加载失败"会把环境说明和错误混在同一视觉里。
          */}
          <StateError
            title="商品信息加载失败"
            desc="没能取回该商品的信息。可能是后端未启动、链接有误或商品已下架。"
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
                onClick={() => navigate('/packages')}
              >
                继续购买
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 确认 + 支付态 ───────────────────────────────────────────────────
  const item = order?.items?.[0];
  const payAmount = order?.paidCents ?? product.priceCents;
  const discount = order?.discountCents ?? 0;

  return (
    <div className="pkg-checkout-page">
      <div className="pkg-checkout-container">
        <button type="button" className="pkg-back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> 返回
        </button>

        <div className="pkg-confirm-card">
          <h2 className="pkg-confirm-title">确认订单</h2>
          <p className="pkg-confirm-sub">
            {product.creditsValidDays > 0
              ? `${product.creditsValidDays} 天内有效`
              : '永久有效'}
          </p>

          <div className="pkg-confirm-row">
            <span>商品</span>
            <strong>{product.name}</strong>
          </div>
          <div className="pkg-confirm-row">
            <span>数量</span>
            <strong>1</strong>
          </div>
          <div className="pkg-confirm-row">
            <span>获得积分</span>
            <strong>{product.credits} 积分</strong>
          </div>

          {/* 券码: 后端对不可用的券降级为不打折而非拒单, 原因随订单返回。
              续付既有订单时不显示 —— 金额与优惠已在那张单上定死, 再改就不是同一笔了。 */}
          {!order && (
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

          {order?.couponWarning && (
            <p className="pkg-pay-hint" style={{ textAlign: 'left', color: '#a32d2d' }}>
              优惠码不可用：{order.couponWarning}
            </p>
          )}

          <div className="pkg-confirm-row pkg-confirm-total">
            <span>应付金额</span>
            <strong>{product.isFree ? '免费' : formatYuan(payAmount)}</strong>
          </div>
          {discount > 0 && (
            <div className="pkg-confirm-offline">
              <span>原价 {formatYuan(item?.priceCents ?? product.priceCents)}</span>
              <span>已优惠 -{formatYuan(discount)}</span>
            </div>
          )}
        </div>

        <div className="pkg-confirm-card">
          <h3 className="pkg-payment-title">支付方式</h3>
          <div className="pkg-payment-options">
            {/*
             * 渠道配色沿用参考站实拍 (支付宝 #009FE8 / 微信 #24B340),
             * 但**只有沙箱可选** —— 未接商户号, 摆出不可用的渠道
             * 只会让用户点了才发现点不了。
             */}
            <div className="pkg-payment-option is-active">
              <span className="pkg-payment-icon is-sandbox">沙</span>
              <div className="pkg-payment-body">
                <div className="pkg-payment-name">沙箱支付</div>
                <div className="pkg-payment-desc">用于开发联调，不产生真实扣款</div>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="pkg-pay-btn"
            disabled={paying}
            onClick={() => void pay('success')}
          >
            {paying ? '处理中…' : `确认支付 ${product.isFree ? '' : formatYuan(payAmount)}`}
          </button>

          {/*
           * 沙箱三态演示。保留失败/超时两个入口是刻意的 ——
           * 只让点成功就等于没做失败路径的验证, 真实通道接入后
           * 回调重复/超时这些分支会第一次被跑到, 那时才发现问题就晚了。
           */}
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

          <div className="pkg-sandbox-notice">
            <AlertTriangle size={14} />
            <span>
              <strong>沙箱环境，不产生真实扣款。</strong>
              微信/支付宝通道尚未接入（无商户号），接入后本页面会替换为真实支付。
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