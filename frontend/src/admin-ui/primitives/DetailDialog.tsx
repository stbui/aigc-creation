import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';

import { Button } from '../components/ui/button';
import { Skeleton } from './skeleton';
import { EmptyState } from './layout';
import { Drawer, ModalDialog, type ModalSize } from './overlay';
import { useDetailData } from './detail-data';

/*
 * 数据生命周期在 `./detail-data`；页面实际使用的展示层是 `../radar/DetailDialog`
 * （`radar/index.ts` 显式覆盖本文件的两个导出）。本文件保留不带 Radar 样式的
 * 共享实现，供不在 `.radar-scope` 内的外壳级场景使用。
 */

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
      onClose={onClose}
      title={title}
      description={description}
      size="lg"
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
 * 宽表格或大图预览时，抽屉的 760px 容易把每一段都挤成两行，改用居中弹窗给足
 * 横向空间。
 */
export function AdminModal<T>({
  open,
  title,
  description,
  size = 'lg',
  onClose,
  fetcher,
  children,
  footer,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  /** 与 `ModalDialog` 同一套档位；详情弹窗默认 `lg`（960）。 */
  size?: ModalSize;
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
      size={size}
      footer={data && footer ? footer(data) : undefined}
    >
      <DetailBody loading={loading} error={error} data={data} onRetry={retry}>
        {children}
      </DetailBody>
    </ModalDialog>
  );
}
