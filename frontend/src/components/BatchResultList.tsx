import './BatchResultList.css';
import './result-list.css';
import { memo, useMemo, useState, type ReactNode } from 'react';
import { Download, ImagePlus, RotateCcw, Trash2 } from 'lucide-react';

import { ImageLightbox, type LightboxItem } from './ImageLightbox';
import { ToolEmptyState } from './ToolEmptyState';
import { Spin, useApp } from '../ui';
import { assetThumbUrl } from '../lib/api';
import { downloadUrlsAsZip } from '../lib/zip';
import type { GalleryItem } from '../hooks/useResultGallery';
import { cellState, formatBatchDate, type BatchRowBase } from './batchResult';

/**
 * 批次结果列表 —— 详情图 / 商品主图 / 带货图文三页共用。
 *
 * 一次提交 = 一行: 行头是日期 + 页面自定义信息, 行内第一格是上传的原图,
 * 之后每格是一次产出 (生成中 / 失败也在格内就地表达)。
 *
 * 2026-11-03 抽取。此前 `DetailResultList` / `ProductKitResultList` /
 * `ShoppableCarouselResultList` 是同一份 DOM 的三份拷贝 (共 833 行),
 * 连 `pd-result-*` / `pk-result-*` 类名都完全一致, 差异只在三处文案,
 * 却各自实现了一遍并在控件上出现分叉 (详情图用 `ui` Button, 另两页用裸
 * `<button>`, 靠 `size-[13px]` 这类补丁拉平尺寸)。
 *
 * 页面语义通过插槽注入, 组件本身不含任何页面类型判断:
 *   - `renderRowMeta`       行头的附加信息 (提示词 / 卖点 / 模板名)
 *   - `renderSourceCaption` 原图格的图注
 *   - `labelOf`             单格的名称
 *
 * `layout="card"` 供商品详情页把一次生成拆成四层信息: 标题 / 参数 / 原图 / 五列图片。
 * 其它页面继续使用默认横向单行布局, 不受详情页的信息密度影响。
 *
 * 归组、状态判定与时间格式化在 `./batchResult`, 本文件只负责渲染。
 */

/** 一行 = 一次生成 (批次内全部任务) */
export type BatchRow = BatchRowBase;

export interface BatchResultListProps<Row extends BatchRow> {
  rows: Row[];
  loading: boolean;
  /** 加载失败信息; 非空时保留已有列表并提示 */
  error?: string | null;
  emptyTitle: string;
  emptyDesc?: string;
  emptyChildren?: ReactNode;
  /** 删除一次生成（批次内全部任务） */
  onDeleteRow: (items: GalleryItem[]) => void;
  /**
   * 卡片布局的「重新生成」：把这次生成的参数回填到页面表单。
   * 不传则不渲染该按钮（其它页面还没有回填契约）。
   */
  onRegenerateRow?: (row: Row) => void;
  /** 下载文件名前缀 */
  downloadNamePrefix: string;
  /** 单格名称（模块名 / 主图变体名 / 第 N 张） */
  labelOf: (item: GalleryItem) => string;
  /** 卡片布局下可覆盖单格展示名（详情页按顺序显示「图片 1」等） */
  cellLabelOf?: (item: GalleryItem, index: number) => string;
  /** 卡片布局的标题行；缺省显示时间 */
  renderRowTitle?: (row: Row) => ReactNode;
  /** 行头附加信息 */
  renderRowMeta?: (row: Row) => ReactNode;
  /** 原图格图注 */
  renderSourceCaption: (row: Row) => ReactNode;
  /** 原图格图注的悬浮提示（图注被省略号截断时的兜底） */
  sourceCaptionTitle?: (row: Row) => string | undefined;
  /** 横向单行（旧页面默认）或分段卡片（商品详情） */
  layout?: 'strip' | 'card';
}

/** 行内可预览的图: 原图在前, 产出图按批次顺序; 生成中 / 失败的不进查看器 */
function lightboxItemsOf<Row extends BatchRow>(
  row: Row,
  labelOf: (item: GalleryItem) => string,
): LightboxItem[] {
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

function downloadName(item: GalleryItem, prefix: string, label: string): string {
  const ext = (item.format || 'png').toLowerCase().replace(/^\./, '') || 'png';
  return `${prefix}-${label}-${item.id.slice(-6)}.${ext}`;
}

function extensionOf(item: GalleryItem): string {
  return (item.format || 'png').toLowerCase().replace(/^\./, '') || 'png';
}

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '-').trim() || 'result';
}

function triggerDownload(item: GalleryItem, prefix: string, label: string) {
  const a = document.createElement('a');
  a.href = item.url;
  a.download = downloadName(item, prefix, label);
  a.click();
}

function BatchResultListImpl<Row extends BatchRow>({
  rows,
  loading,
  error,
  emptyTitle,
  emptyDesc,
  emptyChildren,
  onDeleteRow,
  onRegenerateRow,
  downloadNamePrefix,
  labelOf,
  cellLabelOf,
  renderRowTitle,
  renderRowMeta,
  renderSourceCaption,
  sourceCaptionTitle,
  layout = 'strip',
}: BatchResultListProps<Row>) {
  const { message } = useApp();
  const [preview, setPreview] = useState<{ items: LightboxItem[]; index: number } | null>(null);
  const [downloadingRow, setDownloadingRow] = useState<string | null>(null);
  const isCardLayout = layout === 'card';

  const isEmpty = rows.length === 0;

  const openPreview = (row: Row, itemId: string) => {
    const list = lightboxItemsOf(row, labelOf);
    const index = list.findIndex((entry) => entry.id === itemId);
    if (index < 0) return;
    setPreview({ items: list, index });
  };

  const downloadImage = (item: GalleryItem, label: string) => {
    triggerDownload(item, downloadNamePrefix, label);
    message.success('已开始下载');
  };

  const downloadRow = async (row: Row) => {
    const readyItems = row.cells.filter((item) => Boolean(item.url));
    if (readyItems.length === 0 || downloadingRow) return;

    if (readyItems.length === 1) {
      const item = readyItems[0];
      const index = row.cells.indexOf(item);
      triggerDownload(item, downloadNamePrefix, cellLabelOf?.(item, index) ?? labelOf(item));
      message.success('已开始下载 1 张结果图');
      return;
    }

    setDownloadingRow(row.key);
    try {
      const files = readyItems.map((item, readyIndex) => {
        const index = row.cells.indexOf(item);
        const label = cellLabelOf?.(item, index) ?? labelOf(item);
        return {
          name: `${String(readyIndex + 1).padStart(2, '0')}-${safeFilename(label)}.${extensionOf(item)}`,
          url: item.url,
        };
      });
      await downloadUrlsAsZip(
        `${downloadNamePrefix}-${new Date().toISOString().slice(0, 10)}.zip`,
        files,
      );
      message.success(`已打包下载 ${readyItems.length} 张结果图`);
    } catch {
      // 云端资源未开放 CORS 时 fetch 打包会失败；退回逐张下载，至少不阻断用户。
      readyItems.forEach((item, index) => {
        const cellIndex = row.cells.indexOf(item);
        const label = cellLabelOf?.(item, cellIndex) ?? labelOf(item);
        window.setTimeout(() => triggerDownload(item, downloadNamePrefix, label), index * 180);
      });
      message.warning('打包下载失败，已改为逐张下载');
    } finally {
      setDownloadingRow(null);
    }
  };

  const renderResultCell = (row: Row, item: GalleryItem, index: number) => {
    const state = cellState(item);
    const label = cellLabelOf?.(item, index) ?? labelOf(item);
    const caption = (
      <figcaption className={isCardLayout ? 'pd-result-label u-font-14' : 'pd-result-label u-font-12'} title={label}>
        {label}
      </figcaption>
    );
    return (
      <figure className="pd-result-cell" key={item.id}>
        {isCardLayout && caption}
        {state === 'ready' ? (
          <div className="pd-result-thumb-wrap">
            <button
              type="button"
              className="pd-result-thumb"
              aria-label={`查看${label}大图`}
              onClick={() => openPreview(row, item.id)}
            >
              <img
                src={assetThumbUrl(item.url, 640, true)}
                alt={`${label}生成图`}
                loading="lazy"
              />
            </button>
            <button
              type="button"
              className="pd-result-download"
              aria-label={`下载${label}结果图`}
              title="下载原图"
              onClick={() => downloadImage(item, label)}
            >
              <Download size={14} />
            </button>
          </div>
        ) : (
          <div
            className={`pd-result-thumb u-font-12${state === 'failed' ? ' is-failed' : ' is-pending'}`}
            role="status"
            aria-live="polite"
            aria-label={state === 'failed' ? `${label}生成失败` : `正在生成${label}`}
          >
            {state === 'failed' ? (
              <span className="pd-result-failure-label u-font-12">生成失败</span>
            ) : (
              <>
                <ImagePlus size={20} />
                <span>生成中…</span>
              </>
            )}
          </div>
        )}
        {!isCardLayout && caption}
      </figure>
    );
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
        {error && <p className="tool-submit-notice tool-submit-notice-error">历史生成图加载失败：{error}</p>}

        <div className="pd-result-list">
          {rows.map((row) => {
            return (
              <article className={`pd-result-row${isCardLayout ? ' pd-result-card' : ''}`} key={row.key}>
                <header className={`pd-result-head${isCardLayout ? ' pd-result-card-head' : ''}`}>
                  {isCardLayout ? (
                    renderRowTitle?.(row) ?? (
                      <time className="pd-result-date u-font-12" dateTime={row.createdAt}>
                        {formatBatchDate(row.createdAt)}
                      </time>
                    )
                  ) : (
                    <>
                      <time className="pd-result-date u-font-12" dateTime={row.createdAt}>
                        {formatBatchDate(row.createdAt)}
                      </time>
                      {renderRowMeta?.(row)}
                    </>
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

                {isCardLayout ? (
                  <>
                    {renderRowMeta && <div className="pd-result-card-meta">{renderRowMeta(row)}</div>}

                    <div className="pd-result-card-source u-p-10">
                      <div className="pd-result-card-source-main">
                        {row.sourceUrls.length > 0 ? (
                          <div className="pd-result-card-source-thumbs">
                            {row.sourceUrls.map((sourceUrl, index) => {
                              const sourceLabel =
                                row.sourceUrls.length > 1 ? `商品原图 ${index + 1}` : '商品原图';
                              return (
                                <button
                                  type="button"
                                  className="pd-result-source-thumb"
                                  key={`${row.key}:source:${index}`}
                                  aria-label={`查看${sourceLabel}大图`}
                                  title={sourceLabel}
                                  onClick={() => openPreview(row, `${row.key}:source:${index}`)}
                                >
                                  <img src={assetThumbUrl(sourceUrl, 160)} alt={sourceLabel} loading="lazy" />
                                  {row.sourceUrls.length > 1 && (
                                    <span className="pd-result-source-index u-font-12" aria-hidden="true">
                                      {index + 1}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="pd-result-card-source-empty u-font-12">原图已删除</span>
                        )}
                      </div>
                      {onRegenerateRow && (
                        <button
                          type="button"
                          className="pd-result-regenerate u-font-12"
                          disabled={row.pending}
                          title={row.pending ? '生成中，完成后可重新生成' : '把这次生成的参数带回左侧'}
                          onClick={() => onRegenerateRow(row)}
                        >
                          <RotateCcw size={13} />
                          重新生成
                        </button>
                      )}
                      <button
                        type="button"
                        className="pd-result-download-all u-font-12"
                        aria-label={
                          downloadingRow === row.key
                            ? '正在打包本次生成的结果图'
                            : `一键下载本次生成的 ${row.cells.filter((item) => Boolean(item.url)).length} 张结果图`
                        }
                        title="下载本次生成的全部图片"
                        aria-busy={downloadingRow === row.key}
                        disabled={!row.cells.some((item) => Boolean(item.url)) || Boolean(downloadingRow)}
                        onClick={() => void downloadRow(row)}
                      >
                        <Download size={13} />
                        {downloadingRow === row.key ? '打包中…' : '一键下载'}
                      </button>
                    </div>

                    <div className="pd-result-card-grid">
                      {row.cells.map((item, index) => renderResultCell(row, item, index))}
                    </div>
                  </>
                ) : (
                  <div className="pd-result-strip">
                    {/* 第一格: 上传的全部原图, 下方由图注说明这次用了哪些素材 */}
                    <figure
                      className={`pd-result-cell pd-result-cell-source${row.sourceUrls.length > 1 ? ' is-multiple' : ''}`}
                    >
                      {row.sourceUrls.length > 0 ? (
                        <div
                          className={`pd-result-source-grid${row.sourceUrls.length === 1 ? ' is-single' : ''}${row.sourceUrls.length === 2 ? ' is-pair' : ''}`}
                        >
                          {row.sourceUrls.map((sourceUrl, index) => {
                            const sourceLabel =
                              row.sourceUrls.length > 1 ? `商品原图 ${index + 1}` : '商品原图';
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
                                  <span className="pd-result-source-index u-font-12" aria-hidden="true">
                                    {index + 1}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="pd-result-thumb is-empty u-font-12">
                          <span className="pd-result-empty-tip">原图已删除</span>
                        </div>
                      )}
                      <figcaption className="pd-result-label u-font-12" title={sourceCaptionTitle?.(row)}>
                        {renderSourceCaption(row)}
                      </figcaption>
                    </figure>

                    {/* 其余格: 每张产出, 下方标模块 / 变体 / 张序 */}
                    {row.cells.map((item, index) => renderResultCell(row, item, index))}
                  </div>
                )}
              </article>
            );
          })}
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

/**
 * memo: 左栏表单按键重渲染时, 历史批次只随 `rows` 变化重建。
 * 前提是父页把 `onDeleteRow` / 插槽函数做成稳定引用。
 */
// memo() 会把泛型组件擦成 `NamedExoticComponent`, 这里把泛型签名要回来。
export const BatchResultList = memo(BatchResultListImpl) as unknown as typeof BatchResultListImpl;
