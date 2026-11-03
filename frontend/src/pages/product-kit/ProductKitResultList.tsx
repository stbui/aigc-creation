import { memo, useMemo, useState, type ReactNode } from 'react';
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
 * 商品主图「创作结果」批次列表。
 *
 * 一次提交 = 一行: 行头是日期与提示词, 行内第一格是上传的原图 (下方标商品名称),
 * 之后每格是一张主图 (下方标白底图 / 场景图 / 卖点图)。与通用结果网格相比,
 * 这里保留了「这套图属于同一次生成」的上下文。
 *
 * 数据口径:
 *   - 批次由任务参数 `batchId` 标识, 批内按 `batchIndex` 排序;
 *   - 原图取任务输入素材 (`GalleryItem.inputUrls`), 不是产出素材;
 *   - 没有 batchId 的旧任务各自成行, 标签回落到任务 caption。
 *
 * 纯展示 + 本地交互 (大图 / 下载 / 删除确认由页面接管)。
 */

/** 行内可预览的图: 原图在前, 主图按批次顺序; 生成中 / 失败的不进查看器 */
function lightboxItemsOf(row: ResultRow): LightboxItem[] {
  const list: LightboxItem[] = [];
  for (const [index, sourceUrl] of row.sourceUrls.entries()) {
    const sourceLabel = row.sourceUrls.length > 1 ? `商品原图 ${index + 1}` : '商品原图';
    list.push({
      id: `${row.key}:source:${index}`,
      url: sourceUrl,
      alt: row.productName ? `${row.productName} ${sourceLabel}` : sourceLabel,
      meta: row.productName ? [row.productName, sourceLabel] : [sourceLabel],
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

export interface ProductKitResultListProps {
  items: GalleryItem[];
  loading: boolean;
  /** 加载失败信息; 非空时保留已有列表并提示 */
  error?: string | null;
  emptyTitle: string;
  emptyDesc?: string;
  emptyChildren?: ReactNode;
  onRefresh: () => void;
  /** 删除一次生成（批次内全部任务） */
  onDeleteRow: (items: GalleryItem[]) => void;
  /** 下载文件名前缀 */
  downloadNamePrefix?: string;
}

function ProductKitResultListImpl({
  items,
  loading,
  error,
  emptyTitle,
  emptyDesc,
  emptyChildren,
  onRefresh,
  onDeleteRow,
  downloadNamePrefix = 'main-image',
}: ProductKitResultListProps) {
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
    a.download = downloadFileName(item, downloadNamePrefix);
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
        <ToolEmptyState title={emptyTitle} desc={emptyDesc}>
          {emptyChildren}
        </ToolEmptyState>
      </section>
    );
  }

  return (
    <section className="pk-result-pane">
      <div className="pk-result-body">
        <div className="pk-result-toolbar">
          <div className="pk-result-title">
            生成记录
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
                {row.prompt && (
                  <span className="pd-result-prompt" title={row.prompt}>
                    提示词：{row.prompt}
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
                {/* 第一格: 上传的全部原图, 下方标商品名称与张数 */}
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
                  <figcaption
                    className="pd-result-label"
                    title={
                      row.sourceUrls.length > 1
                        ? `${row.productName || '商品原图'}，共 ${row.sourceUrls.length} 张`
                        : row.productName
                    }
                  >
                    {row.productName || '商品原图'}
                    {row.sourceUrls.length > 1 ? ` · ${row.sourceUrls.length} 张` : ''}
                  </figcaption>
                </figure>

                {/* 其余格: 每张主图, 下方标变体名称 */}
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
export const ProductKitResultList = memo(ProductKitResultListImpl);
