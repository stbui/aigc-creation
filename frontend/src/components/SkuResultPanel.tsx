import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ImageIcon, RotateCcw, TriangleAlert } from 'lucide-react';
import { ImageLightbox } from './ImageLightbox';
import type { TaskStatus } from '../types/api';
import { taskErrorText } from '../lib/constants';
import { assetThumbUrl } from '../lib/api';
import {
  Badge,
  Button,
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateMedia,
  EmptyStateTitle,
  InlineAlert,
  InlineAlertDescription,
  InlineAlertTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../ui';

export interface SkuResultItem {
  id: string;
  label: string;
  status: TaskStatus;
  url?: string;
  width?: number | null;
  height?: number | null;
  errorCode?: string | null;
}

interface Props {
  items: SkuResultItem[];
  /** 尚未生成结果时在右侧展示的已选模板图与框选区域。 */
  source?: {
    url: string;
    label?: string;
    regions?: Array<{
      id?: string;
      x: number;
      y: number;
      width: number;
      height: number;
      type?: string;
    }>;
  } | null;
  error?: string | null;
  notice?: string | null;
  activeId?: string | null;
  onActiveChange: (id: string) => void;
  onDownloadAll: () => void;
  onRetryFailed?: (itemId?: string) => void;
  retrying?: boolean;
}

const isDone = (item?: SkuResultItem) =>
  Boolean(
    item?.url &&
      item.status !== 'queued' &&
      item.status !== 'running' &&
      item.status !== 'failed' &&
      item.status !== 'cancelled',
  );

export function SkuResultPanel({
  items,
  source,
  error,
  notice,
  activeId,
  onActiveChange,
  onDownloadAll,
  onRetryFailed,
  retrying = false,
}: Props) {
  const ready = useMemo(() => items.filter((item) => item.status === 'succeeded' && item.url), [items]);
  const failed = useMemo(() => items.filter((item) => item.status === 'failed'), [items]);
  const active = items.find((item) => item.id === activeId) ?? items[0];
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const sourceStageRef = useRef<HTMLDivElement>(null);
  const [sourceNatural, setSourceNatural] = useState<{ width: number; height: number } | null>(null);
  const [sourceStage, setSourceStage] = useState<{ width: number; height: number } | null>(null);

  /*
   * 区域框按归一化坐标叠在图片上，必须跟图片「contain」后的实际显示尺寸对齐。
   * 图片自身尺寸由 `object-fit` 决定，拿不到渲染 rect，故用舞台尺寸 + 原图尺寸
   * 反算等比缩放后的媒体框，再让区域框相对媒体框定位。
   */
  useEffect(() => {
    if (!source?.url) return;
    const element = sourceStageRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setSourceStage({ width: box.width, height: box.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [source?.url]);

  const sourceMediaSize =
    sourceNatural && sourceStage && sourceStage.width > 0 && sourceStage.height > 0
      ? (() => {
          const scale = Math.min(
            sourceStage.width / sourceNatural.width,
            sourceStage.height / sourceNatural.height,
          );
          return { width: sourceNatural.width * scale, height: sourceNatural.height * scale };
        })()
      : null;

  useEffect(() => {
    if (items.length === 0) return;
    if (!activeId || !items.some((item) => item.id === activeId)) onActiveChange(items[0].id);
  }, [activeId, items, onActiveChange]);

  const previewItems = ready.map((item) => ({
    id: item.id,
    url: item.url!,
    width: item.width ?? undefined,
    height: item.height ?? undefined,
  }));
  const activePreviewIndex = active?.url ? previewItems.findIndex((item) => item.url === active.url) : -1;

  const stage = active ? (
    !active || active.status === 'queued' || active.status === 'running' ? (
      <div className="flex flex-col items-center gap-2" aria-live="polite">
        <Skeleton className="size-11 rounded-xl" />
        <strong className="text-[13px] font-medium text-foreground">
          正在生成 {active?.label ?? 'SKU 图'}…
        </strong>
        <span className="text-xs text-muted-foreground">模型正在保持版式并替换框选区域</span>
      </div>
    ) : active.status === 'failed' || active.status === 'cancelled' ? (
      <InlineAlert variant="destructive" className="w-auto">
        <TriangleAlert aria-hidden />
        <InlineAlertTitle>{active.label} 生成失败</InlineAlertTitle>
        <InlineAlertDescription>
          {active.errorCode ? taskErrorText(active.errorCode) : '任务未能完成，可重试这一张'}
          {onRetryFailed && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={retrying}
              className="mt-1"
              onClick={() => onRetryFailed(active.id)}
            >
              <RotateCcw aria-hidden />
              {retrying ? '重试中…' : '重试此 SKU'}
            </Button>
          )}
        </InlineAlertDescription>
      </InlineAlert>
    ) : active.url ? (
      <>
        <Button
          type="button"
          variant="ghost"
          className="size-full cursor-zoom-in rounded-none p-0 hover:bg-transparent"
          aria-label={`预览 ${active.label}`}
          onClick={() => setPreviewIndex(activePreviewIndex)}
        >
          <img
            src={active.url}
            alt={`${active.label} SKU 图`}
            className="block max-h-full max-w-full object-contain"
          />
        </Button>
        <Badge variant="secondary" className="pointer-events-none absolute right-2 bottom-2">
          {active.label}
        </Badge>
      </>
    ) : null
  ) : null;

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] bg-card p-3.5 max-[900px]:min-h-[560px] max-[480px]:min-h-[520px] max-[480px]:p-3"
      aria-label="SKU 批量结果"
    >
      {items.length > 0 && (
        <div className="mb-3 flex min-h-7 flex-wrap items-center justify-between gap-2">
          <Badge variant="secondary">本批次 {items.length} 个 SKU</Badge>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {failed.length > 0 && onRetryFailed && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={retrying}
                className="text-brand"
                onClick={() => onRetryFailed()}
              >
                <RotateCcw aria-hidden />
                重试失败项 ({failed.length})
              </Button>
            )}
            {ready.length > 0 && (
              <Button type="button" size="sm" onClick={onDownloadAll}>
                <Download aria-hidden />
                一键下载
              </Button>
            )}
          </div>
        </div>
      )}

      {error || notice ? (
        <InlineAlert
          variant={error ? 'destructive' : 'default'}
          className="mb-2.5"
          role="status"
        >
          <InlineAlertDescription>{error || notice}</InlineAlertDescription>
        </InlineAlert>
      ) : null}

      {items.length === 0 ? (
        source?.url ? (
          <div
            ref={sourceStageRef}
            className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[2px]"
          >
            <span
              className="relative block max-h-full max-w-full"
              style={
                sourceMediaSize
                  ? { width: sourceMediaSize.width, height: sourceMediaSize.height }
                  : undefined
              }
            >
              <img
                src={source.url}
                alt={source.label ?? '已选图片'}
                className={`block max-h-full max-w-full object-contain${sourceMediaSize ? ' size-full' : ''}`}
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (naturalWidth > 0 && naturalHeight > 0) {
                    setSourceNatural({ width: naturalWidth, height: naturalHeight });
                  }
                }}
              />
              {source.regions?.map((region, index) => (
                <span
                  key={region.id ?? index}
                  className={`pointer-events-none absolute box-border border-2 border-dashed border-brand bg-brand/10 ${
                    region.type === 'ellipse' ? 'rounded-full' : 'rounded-[5px]'
                  }`}
                  style={{
                    left: `${region.x * 100}%`,
                    top: `${region.y * 100}%`,
                    width: `${region.width * 100}%`,
                    height: `${region.height * 100}%`,
                  }}
                >
                  <Badge className="absolute -top-[9px] -left-[9px] size-[18px] justify-center rounded-full p-0 text-xs">
                    {index + 1}
                  </Badge>
                </span>
              ))}
            </span>
          </div>
        ) : (
          <EmptyState className="flex-1 border-0">
            <EmptyStateMedia variant="icon">
              <ImageIcon aria-hidden />
            </EmptyStateMedia>
            <EmptyStateHeader>
              <EmptyStateTitle className="text-sm font-semibold">商品SKU图</EmptyStateTitle>
              <EmptyStateDescription className="text-xs">
                一张图，批量套出版式完全一致的整组 SKU 图。
              </EmptyStateDescription>
            </EmptyStateHeader>
          </EmptyState>
        )
      ) : (
        <Tabs
          value={active?.id}
          onValueChange={onActiveChange}
          className="min-h-0 flex-1 gap-3"
          aria-label="SKU 结果"
        >
          <TabsContent
            value={active?.id ?? ''}
            className={`relative m-0 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[2px] data-[state=active]:flex ${
              isDone(active) ? 'bg-transparent' : 'bg-muted'
            }`}
          >
            {stage}
          </TabsContent>
          <TabsList className="h-auto w-full justify-start gap-2 overflow-x-auto rounded-none bg-transparent p-0">
            {items.map((item) => (
              <TabsTrigger
                key={item.id}
                value={item.id}
                className="relative h-16 w-14 flex-none overflow-hidden rounded-md border-2 border-transparent bg-muted p-0 data-[state=active]:border-brand/60 data-[state=active]:bg-muted data-[state=active]:shadow-none"
              >
                {item.url ? (
                  <img
                    src={assetThumbUrl(item.url, 240) ?? item.url}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <Skeleton className="size-full rounded-none" />
                )}
                <span className="absolute inset-x-0 bottom-0 truncate bg-foreground/55 px-0.5 py-[3px] text-xs leading-3 text-primary-foreground">
                  {item.label}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {previewIndex !== null && previewIndex >= 0 && (
        <ImageLightbox
          items={previewItems}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </section>
  );
}