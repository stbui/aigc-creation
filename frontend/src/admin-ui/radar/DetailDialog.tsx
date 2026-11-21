import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';

import { useDetailData } from './detail-data';
import { Button } from './Button';
import { Drawer } from './Drawer';
import { EmptyState } from './states';
import { SkeletonBody } from './skeleton';
import { ModalDialog, type ModalSize } from './overlays';

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
        <SkeletonBody rows={6} />
        <p className="text-center text-[12.5px] text-radar-ink-400">加载详情…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-[14px] font-medium text-radar-ink-900">详情加载失败</p>
        <p className="max-w-sm text-[12.5px] leading-5 text-radar-ink-500">{error}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RotateCcw className="size-4" aria-hidden />
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
 * 数据生命周期与 `AdminModal` 共用 `useDetailData`；展示层固定走 Radar
 * `Drawer`，确保 760px 档位、15px 标题与抽屉唯一阴影。
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
