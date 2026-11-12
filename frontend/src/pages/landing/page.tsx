import { useMemo, useState } from 'react';

import { BIZ_CARDS, CASE_GROUPS, TOOL_ENTRIES, type LandingPackageTab } from './constants';
import { useCapabilities, useDocumentMeta, useLandingCatalog } from './hooks';
import { isCapabilityVisible } from './utils';
import { LandingHeader } from './LandingHeader';
import { LandingCases } from './LandingCases';
import { LandingCta } from './LandingCta';
import { LandingFeatures } from './LandingFeatures';
import { LandingFlow } from './LandingFlow';
import { LandingFooter } from './LandingFooter';
import { LandingHero } from './LandingHero';
import { LandingPackages } from './LandingPackages';
import { LandingScenes } from './LandingScenes';
import { LandingTools } from './LandingTools';

/**
 * 营销首页。
 *
 * 结构 (2026-10-31 改版, 类名前缀 `lp-`):
 *   1 首屏   左文案 + 双 CTA + 三条保障, 右 2x2 真实产出拼贴
 *   2 核心场景  商品主图 / 商品详情 / 爆款复刻 三张入口卡
 *   3 修图工具  8 个常用工具, 一屏内完成选择
 *   4 使用流程  上传 → 选能力 → 下载, 三步说明
 *   5 优秀案例  7 个分类平铺长式依次陈列, 每个分类 5 张, 不切页签
 *   6 套餐与积分 订阅 / 加油包 / 限时活动三个页签, 数据全部读接口
 *   7 产品特性  宽卡 + 两张补充卡
 *   8 底部行动区
 *
 * 与参考站的关系: 版面不再是逐像素复刻, 但商业内容 (套餐价目 / 案例图 / 客户 logo)
 * 仍来自 `frontend/public/landing/` 自托管资源; 价目、能力清单、活动一律读后端接口,
 * 页面不写死任何价格或能力数量。品牌标识保留本项目自有 (货觉AI)。
 *
 * 板块拆分见 `docs/frontend-module-conventions.md`：`LandingHero` / `LandingScenes` /
 * `LandingTools` / `LandingFlow` / `LandingCases` / `LandingPackages`（三个页签分别
 * `LandingPlanGrid` / `LandingAddonGrid` / `LandingCampaignGrid`）/ `LandingFeatures` /
 * `LandingCta` / `LandingFooter`；价目与活动取数落 `hooks.ts` 的 `useLandingCatalog`，
 * 可见能力过滤与页签状态仍留在本文件。
 */
export function LandingPage() {
  useDocumentMeta(
    '货觉AI · 电商视觉创作平台',
    '上传商品图，生成能上架的图。商品主图、详情页、营销视觉，一站生成。',
  );
  const { data: capabilityData } = useCapabilities();
  const [pkgTab, setPkgTab] = useState<LandingPackageTab>('sub');
  const { campaigns, addons, addonsState, plans, plansState } = useLandingCatalog();

  /**
   * 首页入口同样跟随能力运行时状态。
   *
   * 能力清单未到达（或请求失败）时保留全部入口：首页是公开首屏，不能因为
   * 一次清单抖动就整块消失。清单到达后再把运营下线的能力隐藏。
   */
  const visibleCapabilityIds = useMemo(() => {
    if (!capabilityData) return null;
    return new Set(capabilityData.items.filter(isCapabilityVisible).map((item) => item.id));
  }, [capabilityData]);
  const bizCards = visibleCapabilityIds
    ? BIZ_CARDS.filter((card) => visibleCapabilityIds.has(card.capability))
    : BIZ_CARDS;
  const toolEntries = visibleCapabilityIds
    ? TOOL_ENTRIES.filter((entry) => visibleCapabilityIds.has(entry.capability))
    : TOOL_ENTRIES;
  /** 首屏文案里的能力数: 取运行时可见能力; 清单未到达时按 CAPABILITY_PLUGINS 声明数兜底 */
  const totalCapabilities = visibleCapabilityIds?.size ?? 17;

  // 案例分组与商品卡、工具入口同口径：运营下线的能力整组不再展示。
  const caseGroups = useMemo(
    () =>
      visibleCapabilityIds
        ? CASE_GROUPS.filter((group) => visibleCapabilityIds.has(group.capability))
        : CASE_GROUPS,
    [visibleCapabilityIds],
  );

  /** 能力清单已到达时，CTA 也必须跟随时运行时可见性，不能指向已下线工具 */
  const canUse = (capability: string) =>
    !visibleCapabilityIds || visibleCapabilityIds.has(capability);

  const primaryTo = bizCards[0]?.to ?? '/workbench';

  return (
    <div className="landing-page" data-route-stage>
      <LandingHeader />

      <LandingHero totalCapabilities={totalCapabilities} primaryTo={primaryTo} />

      <LandingScenes cards={bizCards} />

      <LandingTools entries={toolEntries} />

      <LandingFlow />

      {/* 优秀案例: 7 个分类平铺长式, 不切页签 */}
      {caseGroups.length > 0 && <LandingCases groups={caseGroups} />}

      <LandingPackages
        tab={pkgTab}
        onTabChange={setPkgTab}
        campaigns={campaigns}
        addons={addons}
        addonsState={addonsState}
        plans={plans}
        plansState={plansState}
      />

      <LandingFeatures canUse={canUse} />

      <LandingCta primaryTo={primaryTo} />

      <LandingFooter canUse={canUse} />
    </div>
  );
}
