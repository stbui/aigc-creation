import { memo, useMemo, useState } from 'react';
import { Download, ImagePlus, RefreshCw, Trash2, X } from 'lucide-react';

import { ImageLightbox, ToolEmptyState, type LightboxItem } from './components';
import {
  assetThumbUrl,
  buildRows,
  cellState,
  downloadFileName,
  formatDate,
  labelOf,
  type ResultRow,
} from './utils';
import type { GalleryItem } from './hooks';
import { useApp, Spin } from '../../ui';

/**
 * 「创作结果」批次列表 = 本站的历史记录区。
 *
 * 一次提交 = 一行: 行头是日期与卖点文案, 行内第一格是上传的原图,
 * 之后每格是一张带货图文 (下方标「第 N 张 · 拍名」)。
 *
 * 归组逻辑与 `ProductKitResultList` 同源 (batchId 归组 / batchIndex 排序)，
 * 但**不复用组件** —— 两页的行列语义不同 (带货图文一次出 6–10 格, 且
 * 没有「主图变体」概念), 强行共用会出现条件分支横跨两个页面。
 */

/** 行内可预览的图: 原图在前, 产出图按批次顺序; 生成中 / 失败的不进查看器 */
function lightboxItemsOf(row: ResultRow): LightboxItem[] {
  const list: LightboxItem[] = [];
  for (const [index, sourceUrl] of row.sourceUrls.entries()) {
    const sourceLabel = row.sourceUrls.length > 1 ? `商品原图 ${index + 1}` : '商品原图';
    list.push({
      id: `${row.key}:source:${index}`,
      url: sourceUrl,
      alt: sourceLabel,
      meta: [sourceLabel],
    });
  }
  for (const item of row.cells) {
    if (!item.url) continue;
    list.push({
      id: item.id,
      url: item.url,
      alt: `${labelOf(item)}生成图`,
      width: item.width,
      height: item.height,
      createdAt: item.createdAt,
      meta: [labelOf(item)],
    });
  }
  return list;
}

export interface ShoppableCarouselResultListProps {
  items: GalleryItem[];
  loading: boolean;
  error?: string | null;
  emptyTitle: string;
  emptyDesc?: string;
  onRefresh: () => void;
  /** 删除一次生成（批次内全部任务） */
  onDeleteRow: (items: GalleryItem[]) => void;
}

function ShoppableCarouselResultListImpl({
  items,
  loading,
  error,
  emptyTitle,
  emptyDesc,
  onRefresh,
  onDeleteRow,
}: ShoppableCarouselResultListProps) {
  const { message } = useApp();
  const rows = useMemo(() => buildRows(items), [items]);
  const [preview, setPreview] = useState<{ items: LightboxItem[]; index: number } | null>(null);

  const readyCount = useMemo(() => items.filter((item) => Boolean(item.url)).length, [items]);
  const isEmpty = items.length === 0;

  const openPreview = (row: ResultRow, itemId: string) => {
    const list = lightboxItemsOf(row);
    const index = list.findIndex((entry) => entry.id === itemId);
    if (index < 0) return;
    setPreview({ items: list, index });
  };

  const downloadImage = (item: GalleryItem) => {
    const a = document.createElement('a');
    a.href = item.url;
    a.download = downloadFileName(item);
    a.click();
    message.success('已开始下载');
  };

  if (loading && isEmpty) {
    return (
      <section className="pk-result-pane">
        <div className="fc-result-loading">
          <Spin />
        </div>
      </section>
    );
  }

  if (isEmpty) {
    return (
      <section className="pk-result-pane">
        <ToolEmptyState title={emptyTitle} desc={emptyDesc} />
      </section>
    );
  }

  return (
    <section className="pk-result-pane">
      <div className="pk-result-body">
        <div className="pk-result-toolbar">
          <div className="pk-result-title">
            历史生成记录
            <span className="pk-result-count">
              {rows.length} 次 · {readyCount} 张
            </span>
          </div>
          <div className="fc-result-actions">
            <button type="button" className="pk-result-regen" disabled={loading} onClick={onRefresh}>
              <RefreshCw size={13} />
              {loading ? '刷新中' : '刷新'}
            </button>
          </div>
        </div>

        {error && <p className="tool-submit-notice tool-submit-notice-error">历史生成图加载失败：{error}</p>}

        <div className="pd-result-list">
          {rows.map((row) => (
            <article className="pd-result-row" key={row.key}>
              <header className="pd-result-head">
                <time className="pd-result-date" dateTime={row.createdAt}>
                  {formatDate(row.createdAt)}
                </time>
                {row.templateName && <span className="pd-result-template">模板：{row.templateName}</span>}
                {row.sellingPoints && (
                  <span className="pd-result-prompt" title={row.sellingPoints}>
                    卖点：{row.sellingPoints}
                  </span>
                )}
                <button
                  type="button"
                  className="pd-result-delete"
                  aria-label="删除这次生成的全部图片"
                  title={row.pending ? '生成中，完成后可删除' : '删除这次生成'}
                  disabled={row.pending}
                  onClick={() => onDeleteRow(row.cells)}
                >
                  <Trash2 size={14} />
                </button>
              </header>

              <div className="pd-result-strip">
                {/* 第一格: 上传的原图 */}
                <figure
                  className={`pd-result-cell pd-result-cell-source${row.sourceUrls.length > 1 ? ' is-multiple' : ''}`}
                >
                  {row.sourceUrls.length > 0 ? (
                    <div
                      className={`pd-result-source-grid${row.sourceUrls.length === 1 ? ' is-single' : ''}${row.sourceUrls.length === 2 ? ' is-pair' : ''}`}
                    >
                      {row.sourceUrls.map((sourceUrl, index) => {
                        const sourceLabel = row.sourceUrls.length > 1 ? `商品原图 ${index + 1}` : '商品原图';
                        return (
                          <button
                            type="button"
                            className="pd-result-source-thumb"
                            key={`${row.key}:source:${index}`}
                            aria-label={`查看${sourceLabel}大图`}
                            title={sourceLabel}
                            onClick={() => openPreview(row, `${row.key}:source:${index}`)}
                          >
                            <img src={assetThumbUrl(sourceUrl, 640)} alt={sourceLabel} loading="lazy" />
                            {row.sourceUrls.length > 1 && (
                              <span className="pd-result-source-index" aria-hidden="true">
                                {index + 1}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="pd-result-thumb is-empty">
                      <span className="pd-result-empty-tip">原图已删除</span>
                    </div>
                  )}
                  <figcaption className="pd-result-label" title="上传的商品原图">
                    商品原图
                    {row.sourceUrls.length > 1 ? ` · ${row.sourceUrls.length} 张` : ''}
                  </figcaption>
                </figure>

                {/* 其余格: 每张带货图文, 下方标张序与拍名 */}
                {row.cells.map((item) => {
                  const state = cellState(item);
                  const label = labelOf(item);
                  return (
                    <figure className="pd-result-cell" key={item.id}>
                      {state === 'ready' ? (
                        <div className="pd-result-thumb-wrap">
                          <button
                            type="button"
                            className="pd-result-thumb"
                            aria-label={`查看${label}大图`}
                            onClick={() => openPreview(row, item.id)}
                          >
                            <img src={assetThumbUrl(item.url, 640)} alt={`${label}生成图`} loading="lazy" />
                          </button>
                          <button
                            type="button"
                            className="pd-result-download"
                            aria-label={`下载${label}结果图`}
                            title="下载原图"
                            onClick={() => downloadImage(item)}
                          >
                            <Download size={14} />
                          </button>
                        </div>
                      ) : (
                        <div
                          className={`pd-result-thumb${state === 'failed' ? ' is-failed' : ' is-pending'}`}
                          role="status"
                          aria-label={state === 'failed' ? `${label}生成失败` : `正在生成${label}`}
                        >
                          {state === 'failed' ? <X size={20} /> : <ImagePlus size={20} />}
                          <span>{state === 'failed' ? '生成失败' : '生成中…'}</span>
                        </div>
                      )}
                      <figcaption className="pd-result-label" title={label}>
                        {label}
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      </div>

      {preview && (
        <ImageLightbox
          items={preview.items}
          index={Math.min(preview.index, preview.items.length - 1)}
          onIndexChange={(index) => setPreview((prev) => (prev ? { ...prev, index } : prev))}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  );
}

/** memo: 左栏表单按键重渲染时, 历史批次只随 `items` 变化重建。 */
export const ShoppableCarouselResultList = memo(ShoppableCarouselResultListImpl);
