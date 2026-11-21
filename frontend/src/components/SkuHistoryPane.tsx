import './history-pane.css';
import { useContext, useEffect, useRef, useState } from 'react';
import { ChevronUp, Download, History, RotateCcw } from 'lucide-react';
import { ToolTrailingContext } from './ToolShell';
import { ImageLightbox, type LightboxItem } from './ImageLightbox';
import { assetThumbUrl } from '../lib/api';
import { groupContainsTask, type SkuBatchGroup } from '../lib/skuBatches';
import { StateEmpty, StateError, StateLoading } from './StateViews';
import {
  Badge,
  Button,
  Item,
  ItemActions,
  ItemGroup,
  ItemMedia,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../ui';

const PAGE_SIZE = 10;

interface Props {
  items: SkuBatchGroup[];
  loading: boolean;
  error?: string | null;
  activeId?: string | null;
  onOpen: (group: SkuBatchGroup) => void;
  onRestore: (group: SkuBatchGroup) => void;
  onDownload: (group: SkuBatchGroup) => void;
  onRetry: () => void;
}

/**
 * 历史批次列表。
 *
 * 卡片走 shadcn `Item`（缩略图 + 悬停动作位），不再手写 `article` 加绝对定位按钮；
 * 加载 / 失败 / 空态复用全站状态组件，避免把网络失败渲染成「暂无记录」。
 * 分页是显式「加载更多」，不监听滚动 —— 滚动容器由 `ScrollArea` 的 Viewport
 * 持有，在 Root 上挂 `onScroll` 收不到事件。
 */
function HistoryList({ items, loading, error, activeId, onOpen, onRestore, onDownload, onRetry }: Props) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [preview, setPreview] = useState<{ items: LightboxItem[]; index: number } | null>(null);

  useEffect(() => {
    setVisible((count) => Math.max(PAGE_SIZE, Math.min(count, items.length || PAGE_SIZE)));
  }, [items.length]);

  if (loading && items.length === 0) return <StateLoading size="small" tip="历史记录加载中…" />;
  if (error && items.length === 0) {
    return <StateError compact title="历史记录加载失败" desc={error} onRetry={onRetry} />;
  }
  if (items.length === 0) {
    return <StateEmpty compact title="暂无历史记录" desc="生成成功的批次会按提交出现在这里。" />;
  }

  const openPreview = (group: SkuBatchGroup) => {
    const images: LightboxItem[] = group.items
      .filter((item) => item.url)
      .map((item) => ({
        id: item.id,
        url: item.url,
        width: item.width,
        height: item.height,
        createdAt: item.createdAt,
      }));
    if (images.length === 0) {
      onOpen(group);
      return;
    }
    const coverIndex = group.cover ? images.findIndex((image) => image.id === group.cover!.id) : -1;
    setPreview({ items: images, index: coverIndex >= 0 ? coverIndex : 0 });
  };

  return (
    <>
      <ScrollArea className="min-h-0 flex-1">
        <ItemGroup className="gap-[9px] p-[11px]">
          {items.slice(0, visible).map((group) => {
            const active = Boolean(activeId && groupContainsTask(group, activeId));
            const name = group.label;
            const cover = group.cover;
            return (
              <Item
                key={group.id}
                size="sm"
                className={`group/item relative flex-col flex-nowrap items-stretch gap-0 overflow-hidden rounded-[10px] border p-0 ${
                  active ? 'border-brand/40 ring-1 ring-brand/20' : 'border-border'
                }`}
              >
                <ItemMedia className="relative aspect-square w-full shrink-0 overflow-hidden rounded-none bg-muted">
                  <Button
                    type="button"
                    variant="ghost"
                    className="size-full cursor-zoom-in rounded-none p-0 hover:bg-transparent"
                    aria-label={`查看 ${name} 大图`}
                    onClick={() => openPreview(group)}
                  >
                    {cover?.url ? (
                      <img
                        src={assetThumbUrl(cover.url, 320) ?? cover.url}
                        alt={`${name}历史结果`}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <Skeleton className="size-full rounded-none" />
                    )}
                  </Button>
                  {group.totalCount > 1 && (
                    <Badge className="pointer-events-none absolute top-1.5 left-1.5">
                      {group.items.length < group.totalCount
                        ? `${group.items.length}/${group.totalCount}`
                        : `${group.totalCount} 款`}
                    </Badge>
                  )}
                </ItemMedia>
                <ItemActions className="absolute top-1.5 right-1.5 z-[2] gap-0.5 opacity-0 transition-opacity group-hover/item:opacity-100 group-focus-within/item:opacity-100">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon-xs"
                        className="bg-foreground/55 text-primary-foreground hover:bg-brand"
                        aria-label={`重新编辑 ${name}`}
                        onClick={() => onRestore(group)}
                      >
                        <RotateCcw aria-hidden />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>重新编辑整批</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon-xs"
                        className="bg-foreground/55 text-primary-foreground hover:bg-brand"
                        aria-label={`下载 ${name}`}
                        onClick={() => onDownload(group)}
                      >
                        <Download aria-hidden />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{group.items.length > 1 ? '打包下载整批' : '下载'}</TooltipContent>
                  </Tooltip>
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
        {visible < items.length && (
          <div className="px-[11px] pb-[11px]">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full border-dashed"
              onClick={() => setVisible((count) => Math.min(items.length, count + PAGE_SIZE))}
            >
              加载更多
            </Button>
          </div>
        )}
      </ScrollArea>

      {preview && (
        <ImageLightbox
          items={preview.items}
          index={preview.index}
          onIndexChange={(index) => setPreview((current) => (current ? { ...current, index } : current))}
          onClose={() => setPreview(null)}
          ariaLabel="SKU 历史结果"
        />
      )}
    </>
  );
}

export function SkuHistoryPane(props: Props) {
  const trailing = useContext(ToolTrailingContext);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 1366px)').matches);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const lastRestoreRef = useRef(0);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1366px)');
    const onChange = () => {
      setCompact(query.matches);
      if (!query.matches) setDrawerOpen(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const restoreOnce = (group: SkuBatchGroup) => {
    const now = Date.now();
    if (now - lastRestoreRef.current < 500) return;
    lastRestoreRef.current = now;
    props.onRestore(group);
  };
  const content = <HistoryList {...props} onRestore={restoreOnce} />;

  return (
    <>
      {!trailing?.collapsed && !compact && (
        <aside
          className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] bg-card"
          aria-label="SKU 历史记录"
        >
          <div className="flex min-h-12 flex-none basis-12 items-center justify-between gap-2 px-[11px] text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <History size={15} aria-hidden />
              历史记录
            </span>
            {trailing && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground"
                aria-label="收起历史记录"
                onClick={trailing.toggle}
              >
                <ChevronUp aria-hidden />
              </Button>
            )}
          </div>
          {content}
        </aside>
      )}

      <Button
        type="button"
        size="icon-lg"
        className="product-sku-history-float-toggle tool-history-float-toggle rounded-full shadow-md"
        aria-label={compact ? (drawerOpen ? '收起历史记录' : '展开历史记录') : '展开历史记录'}
        aria-expanded={compact ? drawerOpen : !trailing?.collapsed}
        onClick={() => {
          if (compact) setDrawerOpen((open) => !open);
          else trailing?.toggle();
        }}
      >
        <History aria-hidden />
      </Button>

      {/*
        窄屏历史不再自绘贴边抽屉：交给 shadcn `Sheet`，
        焦点陷阱、Esc、遮罩与关闭后焦点归位都由 Radix 负责。
      */}
      <Sheet open={compact && drawerOpen} onOpenChange={(next) => !next && setDrawerOpen(false)}>
        <SheetContent side="right" className="w-[min(320px,calc(100vw-16px))] gap-0">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-1.5 text-sm">
              <History size={15} aria-hidden />
              历史记录
            </SheetTitle>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col">{content}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}