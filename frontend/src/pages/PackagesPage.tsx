import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, ChevronRight, Clock3, Gem, Wallet } from 'lucide-react';
import { membershipApi, productsApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useCredits } from '../context/CreditsContext';
import { StateError, StateSkeleton } from '../components/StateViews';
import type { MembershipPlan, MyMembership, Product } from '../types/api';

/**
 * 积分商城。
 *
 * 页面结构: 页头(身份/余额) → 会员套餐 → 积分包 → 购买说明。
 * 价目与积分数一律读后端 (`GET /products` / `GET /membership/plans`),
 * 新增或改价只动后台, 本页自动跟随; 前端只做展示层格式化。
 *
 * 金额一律整数分由后端下发, 本页只做 `¥ + 分/100` 的格式化 ——
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

/** 到期日按站内习惯只留年月日 */
function formatDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN');
}

/**
 * 找出「每元积分最多」的在售商品, 用于卡片上的「最划算」标记。
 *
 * 只比较付费商品, 且至少两件时才标记 —— 只有一件付费包时人人都是最划算,
 * 等于没有信息。免费包不参与: 单价比不出高低, 标了反而误导。
 */
function pickBestValueId(products: Product[]): string | null {
  const paid = products.filter((p) => p.priceCents > 0 && p.credits > 0);
  if (paid.length < 2) return null;
  return paid.reduce((best, p) =>
    p.credits / p.priceCents > best.credits / best.priceCents ? p : best,
  ).id;
}

export function PackagesPage() {
  const navigate = useNavigate();
  const { token, openLogin } = useAuth();
  const { balance } = useCredits();
  const [products, setProducts] = useState<Product[]>([]);
  /**
   * 会员套餐也在这里卖。
   *
   * 账户页「开通/续费会员」跳 `/packages`, 本页若只卖积分包, 用户点进来
   * 买不到会员, 链路就断在最后一步。会员与积分包是两种商品, 但同属
   * 「购买入口」, 放在同一页比再开一个会员页更少绕路。
   */
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  /** 当前会员状态: 未登录或不读取失败时为 null, 只影响徽标与文案 */
  const [membership, setMembership] = useState<MyMembership | null>(null);
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
    // 会员套餐拉不到不阻断积分包: 两者独立商品, 各自失败各自空
    setPlans(planRes.status === 'fulfilled' ? planRes.value : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!token) {
      setMembership(null);
      return;
    }
    let alive = true;
    membershipApi
      .me()
      .then((m) => {
        if (alive) setMembership(m);
      })
      .catch((e: unknown) => {
        // 会员详情失败不阻断价目展示: 没有徽标比整页报错更可接受
        console.warn('[packages] 会员详情加载失败，当前方案徽标暂不展示', e);
        if (alive) setMembership(null);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const currentPlanCode = membership?.planCode ?? null;
  const currentPlan = plans.find((p) => p.code === currentPlanCode) ?? null;
  const bestValueId = useMemo(() => pickBestValueId(products), [products]);

  const buy = (p: Product) => {
    if (!token) {
      /*
       * 未登录不跳走 —— 用 openLogin() 弹登录遮罩, 登录成功留在商城。
       * 直接 navigate('/login') 会把用户送离商城, 转化链路断在这里。
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

  /** 会员卡按钮文案: 免费档 / 首订 / 续费 / 升降级 */
  function planActionLabel(plan: MembershipPlan): string {
    if (plan.durationDays <= 0) {
      return currentPlanCode === plan.code ? '当前方案' : '免费档';
    }
    if (!currentPlanCode) return '订阅';
    if (currentPlanCode === plan.code) return '续费';
    if (currentPlan && plan.priceCents < currentPlan.priceCents) return '切换';
    return '升级';
  }

  return (
    <div className="pkg-shop-page">
      <div className="pkg-shop-container">
        <button type="button" className="pkg-back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} aria-hidden /> 返回
        </button>

        <header className="pkg-shop-hero">
          <div className="pkg-shop-hero-main">
            <span className="pkg-shop-hero-icon">
              <Gem size={22} aria-hidden />
            </span>
            <div className="pkg-shop-hero-copy">
              <h1>积分商城</h1>
              <p>积分可用于解锁全部 AI 创作能力，按需购买</p>
            </div>
          </div>
          {token && (
            <button
              type="button"
              className="pkg-shop-balance"
              onClick={() => navigate('/credits')}
              title="查看积分明细"
            >
              <Wallet size={15} aria-hidden />
              <span>当前积分</span>
              <strong>{balance ? formatCredits(balance.balance) : '—'}</strong>
              <ChevronRight size={14} aria-hidden />
            </button>
          )}
        </header>

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
              <div className="pkg-section-copy">
                <h2>会员套餐</h2>
                <p>订阅后每月自动发放积分，享专属权益</p>
              </div>
              {membership?.isMember && (
                <span className="pkg-section-note">
                  当前：{membership.planName}
                  {membership.expiresAt ? ` · ${formatDay(membership.expiresAt)} 到期` : ''}
                </span>
              )}
            </div>
            <div className="pkg-grid">
              {plans.map((plan) => {
                const isCurrent = currentPlanCode === plan.code;
                const isFreePlan = plan.durationDays <= 0;
                return (
                  <article key={plan.id} className={`pkg-card${isCurrent ? ' is-current' : ''}`}>
                    {isCurrent && <span className="pkg-card-flag">当前方案</span>}
                    <div className="pkg-card-top">
                      <span className="pkg-card-name">{plan.name}</span>
                      <span className={`pkg-card-badge${isFreePlan ? ' is-free' : ''}`}>
                        {isFreePlan ? '永久免费' : `${plan.durationDays} 天有效`}
                      </span>
                    </div>
                    <div className="pkg-card-points">
                      <strong>{formatCredits(plan.monthlyCredits)}</strong>
                      <span>积分 / 月</span>
                    </div>
                    <p className="pkg-card-desc">
                      {plan.description ||
                        `订阅 ${plan.durationDays} 天，每月发放 ${plan.monthlyCredits} 积分`}
                    </p>
                    {plan.perkLabels.length > 0 && (
                      <ul className="pkg-card-perks">
                        {plan.perkLabels.map((label) => (
                          <li key={label}>
                            <Check size={13} aria-hidden />
                            {label}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="pkg-card-price">
                      <strong>{isFreePlan ? '免费' : formatYuan(plan.priceCents)}</strong>
                      {!isFreePlan && (
                        <span className="pkg-card-price-unit">/ {plan.durationDays} 天</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="pkg-select-btn"
                      disabled={isFreePlan}
                      onClick={() => subscribe(plan)}
                    >
                      {planActionLabel(plan)}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {!loading && !error && products.length === 0 && plans.length === 0 && (
          <p className="pkg-shop-disclosure">当前没有在售积分包或会员套餐</p>
        )}

        {!loading && products.length > 0 && (
          <section className="pkg-section">
            <div className="pkg-section-head">
              <div className="pkg-section-copy">
                <h2>积分包</h2>
                <p>一次性购买，按需补充；积分有效期以卡片标注为准</p>
              </div>
            </div>
            <div className="pkg-grid is-products">
              {products.map((p) => (
                <article key={p.id} className="pkg-card">
                  <div className="pkg-card-top">
                    <span className="pkg-card-name">{p.name}</span>
                    {p.isFree ? (
                      <span className="pkg-card-badge is-free">免费</span>
                    ) : (
                      p.id === bestValueId && <span className="pkg-card-badge is-hot">最划算</span>
                    )}
                  </div>

                  <div className="pkg-card-points">
                    <strong>{formatCredits(p.credits)}</strong>
                    <span>积分</span>
                  </div>

                  {/* 有效期来自 SKU 而非写死: 加油包永久、订阅卡有期限 */}
                  <span className="pkg-card-validity">
                    <Clock3 size={13} aria-hidden />
                    {p.creditsValidDays > 0 ? `${p.creditsValidDays} 天内有效` : '永久有效'}
                  </span>

                  {p.description && <p className="pkg-card-desc">{p.description}</p>}

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
          </section>
        )}

        {!loading && (
          <p className="pkg-shop-disclosure">
            支付成功后积分自动到账，有效期以卡片标注为准；生成任务按对应能力的消耗价实时扣减，
            任务失败时原额退还。支付方式与金额以结算页为准。
          </p>
        )}
      </div>
    </div>
  );
}
