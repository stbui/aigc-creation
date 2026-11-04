import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ImageIcon, RotateCcw } from 'lucide-react';
import { ImageLightbox } from './ImageLightbox';
import type { TaskStatus } from '../types/api';
import { taskErrorText } from '../lib/constants';
import { assetThumbUrl } from '../lib/api';

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

  return (
    <section className="product-sku-result-panel" aria-label="SKU 批量结果">
      {items.length > 0 && (
        <div className="product-sku-result-heading">
          <div>
            <p>本批次 {items.length} 个 SKU</p>
          </div>
          <div>
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
      )}

      {(notice || error) && (
        <p className={`product-sku-result-notice${error ? ' is-error' : ''}`} role="status">
          {error || notice}
        </p>
      )}

      {items.length === 0 ? (
        source?.url ? (
          <div className="product-sku-stage product-sku-stage-source" ref={sourceStageRef}>
            <span
              className={`product-sku-stage-media${sourceMediaSize ? ' is-sized' : ''}`}
              style={
                sourceMediaSize
                  ? { width: sourceMediaSize.width, height: sourceMediaSize.height }
                  : undefined
              }
            >
              <img
                src={source.url}
                alt={source.label ?? '已选图片'}
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
                  className={`product-sku-stage-region${region.type === 'ellipse' ? ' is-ellipse' : ''}`}
                  style={{
                    left: `${region.x * 100}%`,
                    top: `${region.y * 100}%`,
                    width: `${region.width * 100}%`,
                    height: `${region.height * 100}%`,
                  }}
                >
                  <b>{index + 1}</b>
                </span>
              ))}
            </span>
          </div>
        ) : (
          <div className="product-sku-result-empty">
            <div className="product-sku-result-empty-stage" aria-hidden="true">
              <ImageIcon size={36} />
            </div>
            <strong>商品SKU图</strong>
            <p>一张图，批量套出版式完全一致的整组 SKU 图。</p>
          </div>
        )
      ) : (
        <>
          <div
            className={`product-sku-stage${
              active?.url &&
              active.status !== 'queued' &&
              active.status !== 'running' &&
              active.status !== 'failed' &&
              active.status !== 'cancelled'
                ? ' product-sku-stage-image'
                : ''
            }`}
          >
            {!active || active.status === 'queued' || active.status === 'running' ? (
              <div className="product-sku-generating" aria-live="polite">
                <span className="product-sku-generating-pulse" aria-hidden="true" />
                <strong>正在生成 {active?.label ?? 'SKU 图'}…</strong>
                <span>模型正在保持版式并替换框选区域</span>
              </div>
            ) : active.status === 'failed' || active.status === 'cancelled' ? (
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
                </button>
                <span className="product-sku-stage-label">{active.label}</span>
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
                {item.url ? (
                  <img src={assetThumbUrl(item.url, 240) ?? item.url} alt="" loading="lazy" />
                ) : (
                  <span className="product-sku-thumb-placeholder" />
                )}
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

