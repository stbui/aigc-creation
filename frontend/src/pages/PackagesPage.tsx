import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Gem } from 'lucide-react';
import { membershipApi, productsApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { StateError, StateSkeleton } from '../components/StateViews';
import type { MembershipPlan, Product } from '../types/api';

/**
 * 积分商城 (1:1 复刻参考站版式, 数据已接真实接口)。
 *
 * 版式沿用参考站 `pkg-*` 族 (选包态), 但**价目与积分数一律读 `GET /products`**:
 * 此前此页是硬编码「版式示例数据」+ 按钮禁用, 现已换成后端 SKU 单一事实源。
 * 新增/改价只动后台, 本页自动跟随。
 *
 * 金额一律整数分由后端下发, 本页只做展示层格式化 (¥ + 分/100) ——
 * 边界转换只在一处发生, 避免各处四舍五入不一致。
 */

/** 分 → 「¥39.00」。整数分不该出现小数抖动, 故先转元再保留两位 */
function formatYuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

/** 积分千分位 */
function formatCredits(n: number): string {
  return n.toLocaleString('zh-CN');
}

export function PackagesPage() {
  const navigate = useNavigate();
  const { token, openLogin } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  /**
   * 会员套餐也在这里卖。
   *
   * 此前账户页「开通/续费会员」跳 `/packages`，但本页只拉积分包 —— 用户点进
   * 来买不到会员，链路就断在最后一步。会员与积分包是两种商品，但同属「购买
   * 入口」，放在同一页比再开一个会员页更少绕路。
   */
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [productRes, planRes] = await Promise.allSettled([
      productsApi.list(),
      membershipApi.plans(),
    ]);
    if (productRes.status === 'fulfilled') {
      setProducts(productRes.value);
    } else {
      // 拉不到价目就如实说, 不用硬编码兜底 —— 那正是本次要消灭的东西
      setError((productRes.reason as Error)?.message || '商品加载失败');
    }
    // 会员套餐拉不到不阻断积分包：两者是独立商品，各自失败各自空
    setPlans(planRes.status === 'fulfilled' ? planRes.value : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const buy = (p: Product) => {
    if (!token) {
      /*
       * 未登录不跳走 —— 用 openLogin() 弹登录遮罩, 登录成功留在商城。
       * 与参考站「点购买 → 弹登录框」同构; 直接 navigate('/login')
       * 会把用户送离商城, 转化链路断在这里。
       */
      openLogin();
      return;
    }
    // 结算页自己生成并持有幂等键 —— 同一笔下单重试必须复用同一个 key
    navigate(`/checkout/${p.sku}`);
  };

  const subscribe = (plan: MembershipPlan) => {
    if (!token) {
      openLogin();
      return;
    }
    navigate(`/checkout/membership?planId=${encodeURIComponent(plan.id)}`);
  };

  return (
    <div className="pkg-shop-page">
      <div className="pkg-shop-container">
        <button type="button" className="pkg-back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> 返回
        </button>

        <div className="pkg-shop-hero">
          <h1>
            <Gem size={22} />
            积分商城
          </h1>
          <p>积分可用于解锁全部 AI 创作能力，按需购买</p>
        </div>

        {/*
          加载 / 失败 / 空 三态分开 (2026-10-20 修)。

          此前失败态复用了 `.pkg-sandbox-notice` —— 那个 class 的语义是
          "沙箱支付说明", 拿来渲染"商品加载失败"会把一条环境说明
          和一条错误混在同一视觉里, 用户以为这是正常提示的一部分。
        */}
        {loading && <StateSkeleton variant="card" count={3} columns={3} />}

        {!loading && error && (
          <StateError
            title="商品加载失败"
            desc="没能取回积分包价目。可能是后端未启动或网络异常，重试一次即可。"
            detail={error}
            onRetry={() => void load()}
          />
        )}

        {!loading && plans.length > 0 && (
          <section className="pkg-section">
            <div className="pkg-section-head">
              <h2>会员套餐</h2>
              <p>订阅后每月自动发放积分，享专属权益</p>
            </div>
            <div className="pkg-grid">
              {plans.map((plan) => (
                <article key={plan.id} className="pkg-card">
                  <div className="pkg-card-top">
                    <span className="pkg-card-name">{plan.name}</span>
                    <span className="pkg-card-badge">{plan.durationDays} 天</span>
                  </div>
                  <div className="pkg-card-points">
                    <strong>{formatCredits(plan.monthlyCredits)}</strong>
                    <span>积分 / 月</span>
                  </div>
                  <span className="pkg-card-bonus">
                    {plan.description || `订阅 ${plan.durationDays} 天，每月发放积分`}
                  </span>
                  <div className="pkg-card-price">
                    <strong>{formatYuan(plan.priceCents)}</strong>
                  </div>
                  <button
                    type="button"
                    className="pkg-select-btn"
                    onClick={() => subscribe(plan)}
                  >
                    立即订阅
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        {!loading && !error && products.length === 0 && plans.length === 0 && (
          <p className="pkg-shop-disclosure">当前没有在售积分包或会员套餐</p>
        )}

        <div className="pkg-grid">
          {products.map((p) => (
            <article key={p.id} className="pkg-card">
              <div className="pkg-card-top">
                <span className="pkg-card-name">{p.name}</span>
                {p.isFree && <span className="pkg-card-badge">免费</span>}
              </div>

              <div className="pkg-card-points">
                <strong>{formatCredits(p.credits)}</strong>
                <span>积分</span>
              </div>

              {/* 有效期来自 SKU 而非写死: 加油包永久、订阅卡有期限 */}
              <span className="pkg-card-bonus">
                {p.creditsValidDays > 0 ? `${p.creditsValidDays} 天内有效` : '永久有效'}
              </span>

              <div className="pkg-card-price">
                <strong>{p.isFree ? '免费' : formatYuan(p.priceCents)}</strong>
                {p.originalPriceCents && p.originalPriceCents > p.priceCents && (
                  <span className="pkg-card-price-old">{formatYuan(p.originalPriceCents)}</span>
                )}
              </div>

              <button type="button" className="pkg-select-btn" onClick={() => buy(p)}>
                {p.isFree ? '免费领取' : '立即购买'}
              </button>
            </article>
          ))}
        </div>

        <p className="pkg-shop-disclosure">
          积分包价目与积分数均来自后台商品配置，<strong>非本页硬编码</strong>；生成每次实际扣除的积分
          以能力消耗价为准（同样由后台配置，可在「商品管理 → 能力消耗价」调整）。
          当前支付通道为<strong>沙箱模式，不产生真实扣款</strong>。
        </p>
      </div>
    </div>
  );
}