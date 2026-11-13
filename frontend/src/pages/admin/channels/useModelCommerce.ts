import { useCallback, useEffect, useRef, useState } from 'react';
import { adminModelCommerceApi } from './api';
import type { ModelCommerceOverviewView, ModelCommerceProductView } from '../../../types/model';

/**
 * 商品台账的经营数据（近 N 天调用、净收入、毛利、退款与运营待办）。
 *
 * 独立于商品列表加载：没有 `model.analytics_read` 时不发请求；读取失败也只
 * 影响经营列与筛选，商品台账本身仍要可读。成本未知时后端返回 `null`，
 * 这里原样保留，调用方必须显示「—」而不是 0。
 */
export function useModelCommerce(enabled: boolean, days = 7) {
  const [overview, setOverview] = useState<ModelCommerceOverviewView | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!enabled) {
      setOverview(null);
      setError(null);
      setLoading(false);
      return;
    }
    const current = ++seq.current;
    setLoading(true);
    try {
      const next = await adminModelCommerceApi.overview(days);
      if (current !== seq.current) return;
      setOverview(next);
      setError(null);
    } catch (e) {
      if (current !== seq.current) return;
      setError(e instanceof Error ? e.message : '经营数据读取失败');
    } finally {
      if (current === seq.current) setLoading(false);
    }
  }, [days, enabled]);

  useEffect(() => {
    void reload();
    return () => {
      seq.current += 1;
    };
  }, [reload]);

  return {
    overview,
    loading,
    error,
    reload,
    byModelId: new Map<string, ModelCommerceProductView>(
      (overview?.items ?? []).map((item) => [item.channelModelId, item]),
    ),
  };
}
