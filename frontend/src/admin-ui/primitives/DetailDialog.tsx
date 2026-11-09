import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';

import { Button } from '../components/ui/button';
import { Skeleton } from './skeleton';
import { EmptyState } from './layout';
import { Drawer, ModalDialog } from './overlay';

/**
 * 详情浮层的数据生命周期。
 *
 * ## 为什么浮层自己拉数据
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
 *
 * ## 请求竞态
 *
 * 连续点开两条记录时，先发的请求可能后到。用自增序号丢弃过期响应，
 * 保证屏幕上的详情永远属于当前 `open` 的那一条。
 */
function useDetailData<T>(open: boolean, fetcher: () => Promise<T>) {
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

/** 加载 / 失败 / 空态三种前置状态收口；调用方的渲染函数只写成功态。 */
function DetailBody<T>({
  loading,
  error,
  data,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string | null;
  data: T | null;
  onRetry: () => void;
  children: (data: T) => ReactNode;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2 py-2">
        <Skeleton rows={6} />
        <p className="text-center text-xs text-muted-foreground">加载详情…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm font-medium text-foreground">详情加载失败</p>
        <p className="max-w-sm text-xs leading-5 text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCcw className="size-4" />
          重试
        </Button>
      </div>
    );
  }
  if (data) return <>{children(data)}</>;
  return <EmptyState title="暂无详情" />;
}

/**
 * 详情抽屉（懒加载版）。
 *
 * 适合「从列表进入一条记录的完整上下文」的窄内容：一列信息、少量图片。
 * 数据生命周期见 `useDetailData`；`children` / `footer` 都是渲染函数，
 * 详情到达前不会渲染出空壳。
 */
export function AdminDrawer<T>({
  open,
  title,
  description,
  onClose,
  fetcher,
  children,
  footer,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  fetcher: () => Promise<T>;
  children: (data: T) => ReactNode;
  footer?: (data: T) => ReactNode;
}) {
  const { data, loading, error, retry } = useDetailData(open, fetcher);

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      description={description}
      width={720}
      footer={data && footer ? footer(data) : undefined}
    >
      <DetailBody loading={loading} error={error} data={data} onRetry={retry}>
        {children}
      </DetailBody>
    </Drawer>
  );
}

/**
 * 详情弹窗（懒加载版）。
 *
 * 与 `AdminDrawer` 共用同一套数据生命周期，只换浮层形态：内容包含并排区块、
 * 宽表格或大图预览时，抽屉的 720px 会把每一段都挤成两行，改用居中弹窗给足
 * 横向空间。
 */
export function AdminModal<T>({
  open,
  title,
  description,
  width = 960,
  onClose,
  fetcher,
  children,
  footer,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  width?: number;
  onClose: () => void;
  fetcher: () => Promise<T>;
  children: (data: T) => ReactNode;
  footer?: (data: T) => ReactNode;
}) {
  const { data, loading, error, retry } = useDetailData(open, fetcher);

  return (
    <ModalDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      description={description}
      width={width}
      footer={data && footer ? footer(data) : undefined}
    >
      <DetailBody loading={loading} error={error} data={data} onRetry={retry}>
        {children}
      </DetailBody>
    </ModalDialog>
  );
}
