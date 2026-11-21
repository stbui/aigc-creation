import { useEffect, useRef, useState } from 'react';

/**
 * 详情浮层的数据生命周期。
 *
 * ## 为什么浮层自己拉数据
 *
 * 列表页只带一行的摘要字段；详情要另发一条请求。如果打开列表时就为几十条
 * 记录各拉一次详情，等于把「翻页」变成几十个并发请求。
 *
 * ## 关闭即清空
 *
 * 下次打开的可能是另一条记录 —— 留着上一条的数据会让第一次渲染闪一下旧内容。
 *
 * ## 请求竞态
 *
 * 连续点开两条记录时，先发的请求可能后到。用自增序号丢弃过期响应，
 * 保证屏幕上的详情永远属于当前 `open` 的那一条。
 *
 * 这里只保留数据逻辑：抽屉与弹窗的展示层在 `radar/DetailDialog`，避免共享实现
 * 反向依赖页面视觉层。
 */
export function useDetailData<T>(open: boolean, fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const seq = useRef(0);
  /** 失败态的「重试」靠它重新触发拉取：拉取只依赖 open，值不变不会重跑 */
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!open) {
      setData(null);
      setError(null);
      return;
    }
    const current = ++seq.current;
    setLoading(true);
    setError(null);
    fetcherRef
      .current()
      .then((next) => {
        if (current !== seq.current) return;
        setData(next);
      })
      .catch((next: unknown) => {
        if (current !== seq.current) return;
        setError(next instanceof Error ? next.message : '加载失败');
      })
      .finally(() => {
        if (current === seq.current) setLoading(false);
      });
  }, [open, retryNonce]);

  return {
    data,
    loading,
    error,
    retry: () => setRetryNonce((n) => n + 1),
  };
}
