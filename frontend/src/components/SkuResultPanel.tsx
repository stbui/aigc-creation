import { useEffect, useMemo, useState } from 'react';
import { Download, ImageIcon, Maximize2, RefreshCw, RotateCcw } from 'lucide-react';
import { ImageLightbox } from './ImageLightbox';
import type { TaskStatus } from '../types/api';
import { taskErrorText } from '../lib/constants';

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
  loading?: boolean;
  error?: string | null;
  notice?: string | null;
  activeId?: string | null;
  onActiveChange: (id: string) => void;
  onRefresh: () => void;
  onDownload: (item: SkuResultItem) => void;
  onDownloadAll: () => void;
  onRetryFailed?: (itemId?: string) => void;
  retrying?: boolean;
}

export function SkuResultPanel({
  items,
  loading = false,
  error,
  notice,
  activeId,
  onActiveChange,
  onRefresh,
  onDownload,
  onDownloadAll,
  onRetryFailed,
  retrying = false,
}: Props) {
  const ready = useMemo(() => items.filter((item) => item.status === 'succeeded' && item.url), [items]);
  const failed = useMemo(() => items.filter((item) => item.status === 'failed'), [items]);
  const active = items.find((item) => item.id === activeId) ?? items[0];
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

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

  return (
    <section className="product-sku-result-panel" aria-label="SKU 批量结果">
      <div className="product-sku-result-heading">
        <div>
          <h1>SKU 批量结果</h1>
          {items.length > 0 && <p>本批次 {items.length} 个 SKU</p>}
        </div>
        <div>
          <button
            type="button"
            className="product-sku-result-refresh"
            aria-label="刷新结果"
            title="刷新结果"
            disabled={loading}
            onClick={onRefresh}
          >
            <RefreshCw size={14} />
          </button>
          {failed.length > 0 && onRetryFailed && (
            <button
              type="button"
              className="product-sku-result-retry"
              disabled={retrying}
              onClick={() => onRetryFailed()}
            >
              <RotateCcw size={14} />
              重试失败项 ({failed.length})
            </button>
          )}
          {ready.length > 0 && (
            <button type="button" className="product-sku-result-download-all" onClick={onDownloadAll}>
              <Download size={15} />
              一键下载
            </button>
          )}
        </div>
      </div>

      {(notice || error) && (
        <p className={`product-sku-result-notice${error ? ' is-error' : ''}`} role="status">
          {error || notice}
        </p>
      )}

      {items.length === 0 ? (
        <div className="product-sku-result-empty">
          <div className="product-sku-result-empty-stage" aria-hidden="true">
            <ImageIcon size={36} />
          </div>
          <strong>商品SKU图</strong>
          <p>一张图，批量套出版式完全一致的整组 SKU 图。</p>
        </div>
      ) : (
        <>
          <div className="product-sku-stage">
            {!active || active.status === 'pending' || active.status === 'running' ? (
              <div className="product-sku-generating" aria-live="polite">
                <span className="product-sku-generating-pulse" aria-hidden="true" />
                <strong>正在生成 {active?.label ?? 'SKU 图'}…</strong>
                <span>模型正在保持版式并替换框选区域</span>
              </div>
            ) : active.status === 'failed' ? (
              <div className="product-sku-generating is-error">
                <strong>{active.label} 生成失败</strong>
                <span>{active.errorCode ? taskErrorText(active.errorCode) : '任务未能完成，可重试这一张'}</span>
                {onRetryFailed && (
                  <button
                    type="button"
                    className="product-sku-stage-retry"
                    disabled={retrying}
                    onClick={() => onRetryFailed(active.id)}
                  >
                    <RotateCcw size={13} />
                    {retrying ? '重试中…' : '重试此 SKU'}
                  </button>
                )}
              </div>
            ) : active.url ? (
              <>
                <button
                  type="button"
                  className="product-sku-stage-preview"
                  aria-label={`预览 ${active.label}`}
                  onClick={() => setPreviewIndex(activePreviewIndex)}
                >
                  <img src={active.url} alt={`${active.label} SKU 图`} />
                  <span className="product-sku-stage-hover" aria-hidden="true">
                    <Maximize2 size={18} />
                  </span>
                </button>
                <span className="product-sku-stage-label">{active.label}</span>
                <button
                  type="button"
                  className="product-sku-stage-download"
                  aria-label={`下载 ${active.label}`}
                  title="下载当前 SKU 图"
                  onClick={() => onDownload(active)}
                >
                  <Download size={15} />
                </button>
              </>
            ) : null}
          </div>

          <div className="product-sku-result-thumbnails" role="tablist" aria-label="SKU 结果缩略图">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active?.id === item.id}
                className={active?.id === item.id ? 'active' : undefined}
                title={item.label}
                onClick={() => onActiveChange(item.id)}
              >
                {item.url ? <img src={item.url} alt="" loading="lazy" /> : <span className="product-sku-thumb-placeholder" />}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </>
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

