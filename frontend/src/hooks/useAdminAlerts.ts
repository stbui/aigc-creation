import { useCallback, useEffect, useRef, useState } from 'react';
import { adminApi } from '../lib/api';
import type { AdminAlertsResult } from '../types/api';

/**
 * 告警中心的数据源，顶栏铃铛与 `/admin/alerts` 页共用。
 *
 * 60 秒轮询，后台标签页跳过；失败保留上一次数据；请求序号校验避免慢响应覆盖新响应。
 */
export function useAdminAlerts() {
  const [data, setData] = useState<AdminAlertsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const load = useCallback(async (silent = false) => {
    const current = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const next = await adminApi.alerts();
      if (current !== seq.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (current !== seq.current) return;
      setError(e instanceof Error ? e.message : '告警加载失败');
    } finally {
      if (current === seq.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = (silent: boolean) => {
      if (!alive) return;
      if (document.visibilityState === 'hidden') return;
      void load(silent);
    };
    void load();
    const timer = window.setInterval(() => tick(true), 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return { data, error, loading, reload: load };
}
