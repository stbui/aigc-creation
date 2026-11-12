/**
 * 积分商城页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 通用登录态 / 余额 / SEO 从 `src` 转出；只服务本页的价目取数定义在这里。
 */

import { useCallback, useEffect, useState } from 'react';

import type { MembershipPlan, MyMembership, Product } from '../../types/api';
import { membershipApi, productsApi } from './api';

/** 登录态: 购买前判断是否唤起登录 */
export { useAuth } from '../../context/AuthContext';
/** 顶栏余额上下文 */
export { useCredits } from '../../context/CreditsContext';
/** 路由级 SEO 元信息 */
export { useDocumentMeta } from '../../hooks/useDocumentMeta';

/**
 * 价目与会员状态。
 *
 * 积分包与会员套餐是两种商品，任一失败不阻断另一个；会员详情失败只影响
 * 当前方案徽标，不把整页打成错误态。
 */
export function usePackagesCatalog(token: string | null) {
  const [products, setProducts] = useState<Product[]>([]);
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [membership, setMembership] = useState<MyMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [productResult, planResult] = await Promise.allSettled([
      productsApi.list(),
      membershipApi.plans(),
    ]);
    if (productResult.status === 'fulfilled') {
      setProducts(productResult.value);
    } else {
      // 拉不到价目就如实说, 不用硬编码兜底 —— 那正是本次要消灭的东西
      setError((productResult.reason as Error)?.message || '商品加载失败');
    }
    // 会员套餐拉不到不阻断积分包: 两者独立商品, 各自失败各自空
    setPlans(planResult.status === 'fulfilled' ? planResult.value : []);
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
      .then((current) => {
        if (alive) setMembership(current);
      })
      .catch((cause: unknown) => {
        // 会员详情失败不阻断价目展示: 没有徽标比整页报错更可接受
        console.warn('[packages] 会员详情加载失败，当前方案徽标暂不展示', cause);
        if (alive) setMembership(null);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  return { products, plans, membership, loading, error, reload: load };
}
