import { useContext, useEffect, useRef, useState } from 'react';
import { ChevronRight, ChevronUp, Download, History, RotateCcw } from 'lucide-react';
import { ToolTrailingContext } from './ToolShell';
import { ImageLightbox, type LightboxItem } from './ImageLightbox';
import { assetThumbUrl } from '../lib/api';
import { groupContainsTask, type SkuBatchGroup } from '../lib/skuBatches';
import { Spin } from '../ui';

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

function HistoryList({
  items,
  loading,
  error,
  activeId,
  onOpen,
  onRestore,
  onDownload,
  onRetry,
}: Props) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [preview, setPreview] = useState<{ items: LightboxItem[]; index: number } | null>(null);

  useEffect(() => {
    setVisible((count) => Math.max(PAGE_SIZE, Math.min(count, items.length || PAGE_SIZE)));
  }, [items.length]);

  if (loading && items.length === 0) {
    return (
      <div className="redraw-history-loading" aria-live="polite">
        <Spin size="small" />
        <span>加载中…</span>
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="product-sku-history-state">
        <span>历史记录加载失败</span>
        <button type="button" onClick={onRetry}>重试</button>
      </div>
    );
  }

  if (items.length === 0) return <div className="redraw-history-empty">暂无历史记录</div>;

  return (
    <>
      <div
        className="product-sku-history-list"
        onScroll={(event) => {
          const el = event.currentTarget;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80 && visible < items.length) {
            setVisible((count) => Math.min(items.length, count + PAGE_SIZE));
          }
        }}
      >
        {items.slice(0, visible).map((group) => {
          const active = Boolean(activeId && groupContainsTask(group, activeId));
          const name = group.label;
          const cover = group.cover;
          const openPreview = () => {
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
            <article key={group.id} className={`product-sku-history-card${active ? ' is-active' : ''}`}>
              <button
                type="button"
                className="product-sku-history-preview"
                aria-label={`查看 ${name} 大图`}
                title="查看大图"
                onClick={openPreview}
              >
                {cover?.url ? (
                  <img src={assetThumbUrl(cover.url, 320) ?? cover.url} alt={`${name}历史结果`} loading="lazy" />
                ) : (
                  <span className="product-sku-thumb-placeholder" />
                )}
                {group.totalCount > 1 && (
                  <span className="product-sku-history-count">
                    {group.items.length < group.totalCount ? `${group.items.length}/${group.totalCount}` : `${group.totalCount} 款`}
                  </span>
                )}
              </button>
              <div className="product-sku-history-actions">
                <button type="button" aria-label={`重新编辑 ${name}`} title="重新编辑整批" onClick={() => onRestore(group)}>
                  <RotateCcw size={13} />
                </button>
                <button type="button" aria-label={`下载 ${name}`} title={group.items.length > 1 ? '打包下载整批' : '下载'} onClick={() => onDownload(group)}>
                  <Download size={13} />
                </button>
              </div>
            </article>
          );
        })}
        {visible < items.length && (
          <button type="button" className="product-sku-history-more" onClick={() => setVisible((count) => Math.min(items.length, count + PAGE_SIZE))}>
            加载更多
          </button>
        )}
      </div>

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
  const [compactOpen, setCompactOpen] = useState(false);
  const lastRestoreRef = useRef(0);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1366px)');
    const onChange = () => {
      setCompact(query.matches);
      if (!query.matches) setCompactOpen(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const content = (
    <HistoryList
      {...props}
      onRestore={(group) => {
        const now = Date.now();
        if (now - lastRestoreRef.current < 500) return;
        lastRestoreRef.current = now;
        props.onRestore(group);
      }}
    />
  );

  return (
    <>
      {(!trailing?.collapsed || compact) && (
        <aside
          className={`product-sku-history${compact ? ' is-compact' : ''}${compactOpen ? ' is-compact-open' : ''}`}
          aria-label="SKU 历史记录"
          aria-hidden={compact && !compactOpen ? true : undefined}
          inert={compact && !compactOpen ? true : undefined}
        >
          <div className="history-title">
            <span>
              <History size={15} />
              历史记录
            </span>
            {trailing && (
              <button
                type="button"
                aria-label="收起历史记录"
                title="收起历史记录"
                onClick={() => {
                  if (compact) setCompactOpen(false);
                  else trailing.toggle();
                }}
              >
                {compact ? <ChevronRight size={16} /> : <ChevronUp size={16} />}
              </button>
            )}
          </div>
          {content}
        </aside>
      )}

      <button
        type="button"
        className="product-sku-history-float-toggle tool-history-float-toggle"
        aria-label={compact ? (compactOpen ? '收起历史记录' : '展开历史记录') : '切换历史记录'}
        title={compact ? (compactOpen ? '收起历史记录' : '展开历史记录') : '切换历史记录'}
        aria-expanded={compact ? compactOpen : !trailing?.collapsed}
        onClick={() => {
          if (compact) setCompactOpen((open) => !open);
          else trailing?.toggle();
        }}
      >
        <History size={18} />
      </button>
    </>
  );
}
