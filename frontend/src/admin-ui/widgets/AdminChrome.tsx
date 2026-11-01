import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';

import { Button } from '../shadcn/kit/controls';
import { EmptyState, Result, Skeleton } from '../shadcn/kit/display';
import { Drawer } from '../shadcn/kit/overlay';
import {
  AdminEmpty,
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  AppliedFilters,
  CollapsiblePanel,
  FilterActions,
  FilterBar,
  PageHeader,
  StatCard,
  StatusTag,
} from '../shadcn/kit/display';

/**
 * 后台页面骨架控件（BoardUI 兼容层的 shadcn 实现）。
 *
 * ## 为什么这层还在
 *
 * 35 个存量页面一律从 `admin-ui/widgets/AdminChrome`、`components/admin/PageHeader`
 * 取页头 / 筛选条 / 面板 / 统计卡 / 状态标签。2026-11-01 整站换 shadcn 时，
 * 保持这层**签名不变、实现指向 `admin-ui/shadcn/kit`** —— 调用点一行不改，
 * 渲染全部换掉。
 *
 * ## 只剩 `AdminDrawer`
 *
 * 其余件都是薄转发。`AdminDrawer` 带「打开才拉详情、关闭清空」的数据获取逻辑，
 * 不是纯样式件，所以留在这里，只把渲染换成 shadcn 的 `Drawer` / `Result` / `Skeleton`。
 */

export {
  AdminEmpty,
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  AppliedFilters,
  CollapsiblePanel,
  FilterActions,
  FilterBar,
  PageHeader,
  StatCard,
  StatusTag,
};
export { ConfirmAction } from '../shadcn/kit/overlay';
export type { AppliedFilter } from '../shadcn/kit/display';

/* ────────────────────────── 详情抽屉 ────────────────────────── */

/**
 * 详情抽屉。
 *
 * 懒加载：打开才请求，关闭清空 —— 避免打开列表时就为几十条记录各拉一次详情。
 * children 是渲染函数而非元素，这样详情数据到达前不会渲染出空壳。
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
  /** 失败态的「重试」靠它重新触发拉取；抽屉的拉取只依赖 open，值不变不会重跑 */
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
        <Result
          tone="error"
          title="详情加载失败"
          description={
            <>
              <div>没能取回该条记录详情。</div>
              <div className="mt-1 text-muted-foreground">{error}</div>
            </>
          }
          actions={
            <Button
              variant="secondary"
              size="small"
              leadingIcon={RotateCcw}
              onClick={() => setRetryNonce((n) => n + 1)}
            >
              重试
            </Button>
          }
        />
      ) : data ? (
        children(data)
      ) : (
        <EmptyState title="暂无详情" />
      )}
    </Drawer>
  );
}
