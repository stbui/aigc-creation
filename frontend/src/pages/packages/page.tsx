import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { MembershipPlan, Product } from '../../types/api';
import { PACKAGES_PAGE_META, type PackCounts, type PackFilter } from './constants';
import { StateError, StateSkeleton } from './components';
import { useAuth, useCredits, useDocumentMeta, usePackagesCatalog } from './hooks';
import { pickBestValueId } from './utils';
import { PackagesHero } from './PackagesHero';
import { PackagesPlanSection } from './PackagesPlanSection';
import { PackagesProductSection } from './PackagesProductSection';

/**
 * 积分商城。
 *
 * 页面结构: 页头(身份/余额) → 会员套餐 → 积分包 → 购买说明。
 * 价目与积分数一律读后端 (`GET /products` / `GET /membership/plans`),
 * 新增或改价只动后台, 本页自动跟随; 前端只做展示层格式化。
 *
 * 金额一律整数分由后端下发, 本页只做 `¥ + 分/100` 的格式化 ——
 * 边界转换只在一处发生, 避免各处四舍五入不一致。
 *
 * 板块拆分见 `docs/frontend-module-conventions.md`：页头 `PackagesHero`、
 * 会员 `PackagesPlanSection`、积分包 `PackagesProductSection`；价目与会员状态
 * 取数落 `hooks.ts` 的 `usePackagesCatalog`，按钮文案 / 单价与筛选落 `utils.ts`。
 */
export function PackagesPage() {
  useDocumentMeta(PACKAGES_PAGE_META.title, PACKAGES_PAGE_META.description);
  const navigate = useNavigate();
  const { token, openLogin } = useAuth();
  const { balance } = useCredits();
  const { products, plans, membership, loading, error, reload } = usePackagesCatalog(token);
  /** 积分包有效期筛选: 15 张卡一屏铺开时, 按消费方式先分组再看价 */
  const [packFilter, setPackFilter] = useState<PackFilter>('all');

  const currentPlanCode = membership?.planCode ?? null;
  const currentPlan = plans.find((plan) => plan.code === currentPlanCode) ?? null;
  const bestValueId = useMemo(() => pickBestValueId(products), [products]);
  /** 付费档: 视觉标签按付费档顺序取, 免费档不占位 */
  const paidPlans = useMemo(() => plans.filter((plan) => plan.durationDays > 0), [plans]);
  /** 免费档: 单独压成一行基线说明, 不参与套餐卡排列 */
  const freePlan = useMemo(
    () => plans.find((plan) => plan.durationDays <= 0) ?? null,
    [plans],
  );
  const packCounts = useMemo<PackCounts>(
    () => ({
      all: products.length,
      short: products.filter((product) => product.creditsValidDays > 0).length,
      forever: products.filter((product) => product.creditsValidDays === 0).length,
    }),
    [products],
  );
  const shownPacks = useMemo(() => {
    if (packFilter === 'all') return products;
    return products.filter((product) =>
      packFilter === 'short' ? product.creditsValidDays > 0 : product.creditsValidDays === 0,
    );
  }, [products, packFilter]);

  const buy = (product: Product) => {
    if (!token) {
      /*
       * 未登录不跳走 —— 用 openLogin() 弹登录遮罩, 登录成功留在商城。
       * 直接 navigate('/login') 会把用户送离商城, 转化链路断在这里。
       */
      openLogin();
      return;
    }
    // 结算页自己生成并持有幂等键 —— 同一笔下单重试必须复用同一个 key
    navigate(`/checkout/${product.sku}`);
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
        <PackagesHero loggedIn={Boolean(token)} balance={balance?.balance ?? null} />

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
            onRetry={() => void reload()}
          />
        )}

        {!loading && plans.length > 0 && (
          <PackagesPlanSection
            paidPlans={paidPlans}
            freePlan={freePlan}
            membership={membership}
            currentPlanCode={currentPlanCode}
            currentPlan={currentPlan}
            onSubscribe={subscribe}
          />
        )}

        {!loading && !error && products.length === 0 && plans.length === 0 && (
          <p className="pkg-shop-disclosure">当前没有在售积分包或会员套餐</p>
        )}

        {!loading && products.length > 0 && (
          <PackagesProductSection
            products={shownPacks}
            counts={packCounts}
            bestValueId={bestValueId}
            filter={packFilter}
            onFilterChange={setPackFilter}
            onBuy={buy}
          />
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
