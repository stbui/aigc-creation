import { useEffect, useState } from 'react';
import { loadCapabilities, type CapabilitiesData } from '../lib/capabilities';

export interface UseCapabilitiesResult {
  data: CapabilitiesData | null;
  loading: boolean;
  error: string | null;
}

/** 组件入口: 拉取能力清单 (模块级缓存, 多组件并发调用只发一次请求) */
export function useCapabilities(): UseCapabilitiesResult {
  const [data, setData] = useState<CapabilitiesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadCapabilities()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message || '能力清单加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { data, loading, error };
}
