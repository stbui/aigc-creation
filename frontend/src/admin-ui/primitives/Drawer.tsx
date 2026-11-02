import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';

import { Button } from '../components/ui/button';
import { Skeleton } from './skeleton';
import { EmptyState } from './layout';
import { Drawer } from './overlay';

/**
 * 详情抽屉（懒加载版）。
 *
 * ## 为什么抽屉自己拉数据
 *
 * 列表页只带一行的摘要字段；详情要另发一条请求。如果打开列表时就为几十条
 * 记录各拉一次详情，等于把「翻页」变成几十个并发请求。
 *
 * `children` 是**渲染函数**而不是元素：详情到达前根本不会渲染出空壳，
 * 调用方也就不必在 children 里到处判空。
 *
 * ## 关闭即清空
 *
 * 下次打开的可能是另一条记录 —— 留着上一条的数据会让第一次渲染闪一下旧内容。
 */
export function AdminDrawer<T>({
  open,
  title,
  onClose,
  fetcher,
  children,
  footer,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  fetcher: () => Promise<T>;
  children: (data: T) => ReactNode;
  footer?: (data: T) => ReactNode;
}) {
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

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      width={720}
      footer={data && footer ? footer(data) : undefined}
    >
      {loading ? (
        <div className="flex flex-col gap-2 py-2">
          <Skeleton rows={6} />
          <p className="text-center text-xs text-muted-foreground">加载详情…</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm font-medium text-foreground">详情加载失败</p>
          <p className="max-w-sm text-xs leading-5 text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={() => setRetryNonce((n) => n + 1)}>
            <RotateCcw className="size-4" />
            重试
          </Button>
        </div>
      ) : data ? (
        children(data)
      ) : (
        <EmptyState title="暂无详情" />
      )}
    </Drawer>
  );
}
