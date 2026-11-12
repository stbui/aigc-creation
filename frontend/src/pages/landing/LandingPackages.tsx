import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import type { MembershipPlan, Product, PromoCampaign } from '../../types/api';
import type { LandingPackageTab } from './constants';
import type { LandingCatalogState } from './hooks';
import { LandingAddonGrid } from './LandingAddonGrid';
import { LandingCampaignGrid } from './LandingCampaignGrid';
import { LandingPlanGrid } from './LandingPlanGrid';

interface LandingPackagesProps {
  tab: LandingPackageTab;
  onTabChange: (tab: LandingPackageTab) => void;
  campaigns: PromoCampaign[];
  addons: Product[];
  addonsState: LandingCatalogState;
  plans: MembershipPlan[];
  plansState: LandingCatalogState;
}

/** 套餐与积分：订阅 / 加油包 / 限时活动三个页签，数据全部读接口。 */
export function LandingPackages({
  tab,
  onTabChange,
  campaigns,
  addons,
  addonsState,
  plans,
  plansState,
}: LandingPackagesProps) {
  return (
    <section className="lp-section" id="packages">
      <div className="lp-packages-head">
        <div>
          <span className="lp-kicker">套餐与积分</span>
          <h2>按需订阅，或随时加油</h2>
          <p>订阅套餐每月发放积分；积分包一次购买，有效期以卡片标注为准。</p>
        </div>
        <Link to="/packages" className="lp-text-link">
          进入积分商城
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
      <div className="lp-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'sub'}
          className={tab === 'sub' ? 'is-active' : ''}
          onClick={() => onTabChange('sub')}
        >
          订阅套餐
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'addon'}
          className={tab === 'addon' ? 'is-active' : ''}
          onClick={() => onTabChange('addon')}
        >
          加油包
        </button>
        {/* 页签只在真有活动时出现 —— 不做永远点不开的禁用页签 */}
        {campaigns.length > 0 && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'campaign'}
            className={tab === 'campaign' ? 'is-active' : ''}
            onClick={() => onTabChange('campaign')}
          >
            限时活动
          </button>
        )}
      </div>
      <div className="lp-packages-body">
        {tab === 'sub' ? (
          <LandingPlanGrid plans={plans} state={plansState} />
        ) : tab === 'addon' ? (
          <LandingAddonGrid addons={addons} state={addonsState} />
        ) : (
          <LandingCampaignGrid campaigns={campaigns} />
        )}
      </div>
    </section>
  );
}
