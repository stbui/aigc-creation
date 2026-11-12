/**
 * 营销首页的 hooks 入口 —— 目录内文件的唯一 hooks 来源。
 *
 * 约定: `landing/` 下的文件不从 `src/hooks` / `src/context` 直接取 hook,
 * 一律经由本文件。
 */

import { useEffect, useState } from 'react';

import type { MembershipPlan, Product, PromoCampaign } from '../../types/api';
import { membershipApi, myMarketingApi, productsApi } from './api';

/** 能力清单 (导航分组、入口可见性、CTA 判定) */
export { useCapabilities } from '../../hooks/useCapabilities';
/** 路由级 SEO 元信息 */
export { useDocumentMeta } from '../../hooks/useDocumentMeta';
/** 登录态 (顶导「进入工作台 / 登录注册」) */
export { useAuth } from '../../context/AuthContext';

/** 价目接口的加载 / 失败 / 就绪三态 */
export type LandingCatalogState = 'loading' | 'error' | 'ready';

/**
 * 首页价目与活动：积分包 / 订阅套餐 / 限时活动。
 *
 * 三个接口互不依赖，一个失败不拖垮另外两个；失败时如实留空并按状态渲染
 * 空态，不回落任何硬编码价目。活动失败视为没有活动（页签不出现）。
 */
export function useLandingCatalog() {
  const [campaigns, setCampaigns] = useState<PromoCampaign[]>([]);
  const [addons, setAddons] = useState<Product[]>([]);
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [plansState, setPlansState] = useState<LandingCatalogState>('loading');
  const [addonsState, setAddonsState] = useState<LandingCatalogState>('loading');

  useEffect(() => {
    let alive = true;
    productsApi
      .list()
      .then((list) => {
        if (!alive) return;
        setAddons(list);
        setAddonsState('ready');
      })
      .catch(() => {
        if (!alive) return;
        setAddons([]);
        setAddonsState('error');
      });
    membershipApi
      .plans()
      .then((list) => {
        if (!alive) return;
        setPlans(list);
        setPlansState('ready');
      })
      .catch(() => {
        if (!alive) return;
        setPlans([]);
        setPlansState('error');
      });
    myMarketingApi
      .campaigns()
      .then((list) => {
        if (alive) setCampaigns(list);
      })
      .catch(() => {
        if (alive) setCampaigns([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { campaigns, addons, addonsState, plans, plansState };
}
