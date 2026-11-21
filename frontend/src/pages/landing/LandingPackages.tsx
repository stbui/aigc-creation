import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import type { MembershipPlan, Product, PromoCampaign } from '../../types/api';
import type { LandingPackageTab } from './constants';
import type { LandingCatalogState } from './hooks';
import { TextAction, Tabs, TabsContent, TabsList, TabsTrigger } from './components';
import { LandingHeading, LandingKicker, LandingLede, LandingSection } from './LandingSection';
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

/**
 * 套餐与积分：订阅 / 加油包 / 限时活动三个页签，数据全部读接口。
 *
 * 2026-11-21 组件层重构：手写 `role="tablist"` + `is-active` 类名换成 shadcn
 * `Tabs`（真实页签语义：每个页签对应一块内容面板，方向键在页签间移动）。
 * 「限时活动」只在真有活动时渲染 —— 不做永远点不开的禁用页签。
 */
export function LandingPackages({
  tab,
  onTabChange,
  campaigns,
  addons,
  addonsState,
  plans,
  plansState,
}: LandingPackagesProps) {
  // 活动被后端撤回时页签会消失；此时落回订阅页，避免内容区空白
  const activeTab = tab === 'campaign' && campaigns.length === 0 ? 'sub' : tab;

  return (
    <LandingSection id="packages">
      <div className="flex flex-wrap items-end justify-between gap-6 max-[900px]:flex-col max-[900px]:items-start max-[900px]:gap-4">
        <div>
          <LandingKicker>套餐与积分</LandingKicker>
          <LandingHeading>按需订阅，或随时加油</LandingHeading>
          <LandingLede>订阅套餐每月发放积分；积分包一次购买，有效期以卡片标注为准。</LandingLede>
        </div>
        <TextAction asChild className="font-semibold whitespace-nowrap">
          <Link to="/packages">
            进入积分商城
            <ArrowRight size={14} aria-hidden />
          </Link>
        </TextAction>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(next) => onTabChange(next as LandingPackageTab)}
        className="mt-7 gap-0"
      >
        <TabsList className="h-10.5 w-fit gap-1 rounded-full bg-muted p-1">
          <TabsTrigger
            value="sub"
            className="h-8.5 rounded-full px-5 text-[13.5px] font-medium text-muted-foreground shadow-none data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_4px_color-mix(in_srgb,var(--text-strong)_10%,transparent)]"
          >
            订阅套餐
          </TabsTrigger>
          <TabsTrigger
            value="addon"
            className="h-8.5 rounded-full px-5 text-[13.5px] font-medium text-muted-foreground shadow-none data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_4px_color-mix(in_srgb,var(--text-strong)_10%,transparent)]"
          >
            加油包
          </TabsTrigger>
          {campaigns.length > 0 && (
            <TabsTrigger
              value="campaign"
              className="h-8.5 rounded-full px-5 text-[13.5px] font-medium text-muted-foreground shadow-none data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_4px_color-mix(in_srgb,var(--text-strong)_10%,transparent)]"
            >
              限时活动
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="sub" className="mt-6">
          <LandingPlanGrid plans={plans} state={plansState} />
        </TabsContent>
        <TabsContent value="addon" className="mt-6">
          <LandingAddonGrid addons={addons} state={addonsState} />
        </TabsContent>
        <TabsContent value="campaign" className="mt-6">
          <LandingCampaignGrid campaigns={campaigns} />
        </TabsContent>
      </Tabs>
    </LandingSection>
  );
}