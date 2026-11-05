import './PackagesPage.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, ChevronRight, Clock3, Gem, Wallet } from 'lucide-react';
import { membershipApi, productsApi } from '../lib/api';
import { PLAN_VISUALS } from '../lib/constants';
import { formatDate, formatNumber, formatYuan } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useCredits } from '../context/CreditsContext';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
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

/**
 * 折合单价 (元 / 积分)，只对「付费且积分 > 0」的商品有意义。
 *
 * 购包时用户真正比较的是单价而不是总价 —— 总价随档位单调上升，
 * 只给总价等于让人自己做除法。保留 4 位小数：积分单价普遍在 0.01–0.03 元。
 */
function formatPerCredit(p: Product): string | null {
  if (p.priceCents <= 0 || p.credits <= 0) return null;
  return `¥${(p.priceCents / p.credits / 100).toFixed(4)}`;
}

/** 积分包按有效期分组：31 天短期包与永久包是两种消费方式，混在一排里没法比较 */
const PACK_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'short', label: '31 天有效' },
  { key: 'forever', label: '永久有效' },
] as const;
type PackFilter = (typeof PACK_FILTERS)[number]['key'];

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
  useDocumentMeta('积分商城 · 货觉AI', '购买积分包与会员套餐，解锁全部 AI 创作能力。');
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
  /** 积分包有效期筛选: 15 张卡一屏铺开时, 按消费方式先分组再看价 */
  const [packFilter, setPackFilter] = useState<PackFilter>('all');

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
  /** 付费档: 视觉标签按付费档顺序取, 免费档不占位 */
  const paidPlans = useMemo(() => plans.filter((p) => p.durationDays > 0), [plans]);
  /** 免费档: 单独压成一行基线说明, 不参与套餐卡排列 */
  const freePlan = useMemo(() => plans.find((p) => p.durationDays <= 0) ?? null, [plans]);
  const packCounts = useMemo(
    () => ({
      all: products.length,
      short: products.filter((p) => p.creditsValidDays > 0).length,
      forever: products.filter((p) => p.creditsValidDays === 0).length,
    }),
    [products],
  );
  const shownPacks = useMemo(() => {
    if (packFilter === 'all') return products;
    return products.filter((p) =>
      packFilter === 'short' ? p.creditsValidDays > 0 : p.creditsValidDays === 0,
    );
  }, [products, packFilter]);

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
              <strong>{balance ? formatNumber(balance.balance) : '—'}</strong>
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
                  {membership.expiresAt ? ` · ${formatDate(membership.expiresAt, '')} 到期` : ''}
                </span>
              )}
            </div>
            {/*
             * 免费档不作为商品陈列: 它没有价格、没有月度配额、也没有可点的按钮,
             * 混在付费卡里只会撑出一张空心卡并打乱行数。压成一行基线说明,
             * 付费档就能整齐排成 3×2。
             */}
            {freePlan && (
              <div className="pkg-free-strip">
                <span className="pkg-free-strip-name">{freePlan.name}</span>
                <span className="pkg-card-badge is-free">永久免费</span>
                <span className="pkg-free-strip-desc">{freePlan.description}</span>
              </div>
            )}
            <div className="pkg-grid is-plans">
              {paidPlans.map((plan, i) => {
                const isCurrent = currentPlanCode === plan.code;
                // 视觉标签按付费档顺序取; 后台新加的档位没有标签时回落有效期
                const visual = PLAN_VISUALS[i];
                return (
                  <article
                    key={plan.id}
                    className={`pkg-card${isCurrent ? ' is-current' : visual?.recommended ? ' is-recommended' : ''}`}
                  >
                    {isCurrent && <span className="pkg-card-flag">当前方案</span>}
                    <div className="pkg-card-top">
                      <span className="pkg-card-name">{plan.name}</span>
                      <span
                        className={`pkg-card-badge${visual?.recommended ? ' is-hot' : ''}`}
                      >
                        {visual?.tag ?? `${plan.durationDays} 天有效`}
                      </span>
                    </div>
                    <div className="pkg-card-points">
                      <strong>{formatNumber(plan.monthlyCredits)}</strong>
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
                      <strong>{formatYuan(plan.priceCents)}</strong>
                      <span className="pkg-card-price-unit">/ {plan.durationDays} 天</span>
                    </div>
                    <button
                      type="button"
                      className="pkg-select-btn"
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
              {/* 只展示真实存在分类的筛选项: 永远给一个点开是空列表的按钮没有意义 */}
              <div className="pkg-filter" role="group" aria-label="按有效期筛选">
                {PACK_FILTERS.filter((f) => packCounts[f.key] > 0).map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={packFilter === f.key}
                    className={`pkg-filter-btn${packFilter === f.key ? ' is-active' : ''}`}
                    onClick={() => setPackFilter(f.key)}
                  >
                    {f.label}
                    <span>{packCounts[f.key]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="pkg-grid is-products">
              {shownPacks.map((p) => (
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
                    <strong>{formatNumber(p.credits)}</strong>
                    <span>积分</span>
                  </div>

                  {/* 有效期来自 SKU 而非写死; 折合单价由价格 / 积分算出, 不写进商品文案 */}
                  <div className="pkg-card-meta">
                    <span className="pkg-card-validity">
                      <Clock3 size={13} aria-hidden />
                      {p.creditsValidDays > 0 ? `${p.creditsValidDays} 天内有效` : '永久有效'}
                    </span>
                    {formatPerCredit(p) && (
                      <span className="pkg-card-unit">折合 {formatPerCredit(p)} / 分</span>
                    )}
                  </div>

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
