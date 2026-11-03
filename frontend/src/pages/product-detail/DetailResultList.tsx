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
import { useApp, Button, Spin } from '../../ui';

/**
 * 商品详情图「创作结果」批次列表。
 *
 * 一次生成 = 一行: 行头是日期与提示词, 行内第一格是上传的原图 (下方标商品名称),
 * 之后每格是一张模块图 (下方标模块名称)。这与网格结果栏的区别是**归组**:
 * 网格把每张图当独立作品, 用户看不出「这 6 张是同一次生成的」。
 *
 * 数据口径:
 *   - 批次由任务参数 `batchId` 标识, 批内按 `batchIndex` 排序;
 *   - 原图取任务输入素材 (`GalleryItem.inputUrls`), 不是产出素材;
 *   - 没有 batchId 的旧任务 (一次只出一张图) 各自成行, 标签回落到任务 caption。
 *
 * 纯展示 + 本地交互 (大图 / 下载 / 删除确认由页面接管), 与 ResultGalleryPane 同一定位。
 *
 * 归组、状态判定、时间格式化等纯函数在 `./utils`, 本文件只负责渲染。
 */

/** 行内可预览的图: 原图在前, 模块图按批次顺序; 生成中 / 失败的不进查看器 */
function lightboxItemsOf(row: ResultRow): LightboxItem[] {
  const list: LightboxItem[] = [];
  /*
   * 一次任务可以带多张商品图（最多 5 张），它们都是这次生成的输入。
   * 查看器按「原图 1..n → 模块图」排列，双击第一格任一缩略图都能落到对应原图。
   */
  row.sourceUrls.forEach((url, index) => {
    const ordinal = row.sourceUrls.length > 1 ? ` ${index + 1}/${row.sourceUrls.length}` : '';
    list.push({
      id: `${row.key}:source:${index}`,
      url,
      alt: row.productName ? `${row.productName}原图${ordinal}` : `商品原图${ordinal}`,
      meta: row.productName ? [row.productName, `原图${ordinal}`.trim()] : [`原图${ordinal}`.trim()],
    });
  });
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

export interface DetailResultListProps {
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

function DetailResultListImpl({
  items,
  loading,
  error,
  emptyTitle,
  emptyDesc,
  emptyChildren,
  onRefresh,
  onDeleteRow,
  downloadNamePrefix = 'product-detail',
}: DetailResultListProps) {
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
            <Button type="text" className="pk-result-regen" disabled={loading} onClick={onRefresh}>
              <RefreshCw size={13} className="size-[13px]" />
              {loading ? '刷新中' : '刷新'}
            </Button>
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
                <Button
                  type="text"
                  className="pd-result-delete"
                  aria-label="删除这次生成的全部图片"
                  title={row.pending ? '生成中，完成后可删除' : '删除这次生成'}
                  disabled={row.pending}
                  onClick={() => onDeleteRow(row.cells)}
                >
                  <Trash2 size={14} className="size-[14px]" />
                </Button>
              </header>

                <div className="pd-result-strip">
                  {/* 第一格: 上传的原图, 下方标商品名称。
                      一次任务最多可带 5 张商品图, 全部铺开而不是只露首图 ——
                      否则用户看不出这次生成本身用了几张素材。 */}
                  {row.sourceUrls.length === 0 ? (
                    <figure className="pd-result-cell pd-result-cell-source">
                      <div className="pd-result-thumb is-empty">
                        <span className="pd-result-empty-tip">原图已删除</span>
                      </div>
                      <figcaption className="pd-result-label" title={row.productName}>
                        {row.productName || '商品原图'}
                      </figcaption>
                    </figure>
                  ) : (
                    <figure
                      className={`pd-result-cell pd-result-cell-source${row.sourceUrls.length > 1 ? ' is-multiple' : ''}`}
                    >
                      <div
                        className={`pd-result-source-grid${
                          row.sourceUrls.length === 1 ? ' is-single' : row.sourceUrls.length === 2 ? ' is-pair' : ''
                        }`}
                      >
                        {row.sourceUrls.map((url, index) => {
                          const ordinal = index + 1;
                          const label = row.productName
                            ? `${row.productName}原图${row.sourceUrls.length > 1 ? ` ${ordinal}` : ''}`
                            : `商品原图${row.sourceUrls.length > 1 ? ` ${ordinal}` : ''}`;
                          return (
                            <Button
                              key={`${row.key}:source:${index}`}
                              type="text"
                              className="pd-result-source-thumb"
                              aria-label={`查看${label}`}
                              title={label}
                              onClick={() => openPreview(row, `${row.key}:source:${index}`)}
                            >
                              <img src={assetThumbUrl(url, 320)} alt={label} loading="lazy" />
                              {row.sourceUrls.length > 1 && (
                                <span className="pd-result-source-index">{ordinal}</span>
                              )}
                            </Button>
                          );
                        })}
                      </div>
                      <figcaption className="pd-result-label" title={row.productName}>
                        {row.productName || '商品原图'}
                        {row.sourceUrls.length > 1 ? ` · ${row.sourceUrls.length} 张` : ''}
                      </figcaption>
                    </figure>
                  )}

                  {/* 其余格: 每张模块图, 下方标模块名称 */}
                  {row.cells.map((item) => {
                    const state = cellState(item);
                    const label = labelOf(item);
                    return (
                      <figure className="pd-result-cell" key={item.id}>
                        {state === 'ready' ? (
                          <div className="pd-result-thumb-wrap">
                            <Button
                              type="text"
                              className="pd-result-thumb"
                              aria-label={`查看${label}大图`}
                              onClick={() => openPreview(row, item.id)}
                            >
                              <img src={assetThumbUrl(item.url, 640)} alt={`${label}生成图`} loading="lazy" />
                            </Button>
                            <Button
                              type="text"
                              className="pd-result-download"
                              aria-label={`下载${label}结果图`}
                              title="下载原图"
                              onClick={() => downloadImage(item)}
                            >
                              <Download size={14} className="size-[14px]" />
                            </Button>
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

/**
 * memo: 左栏表单每敲一个字都会重渲染整页, 而结果行只随 `items` 变化 ——
 * 历史批次 (每行原图 + 各模块图) 不该跟着输入节奏逐帧重建。
 * 前提是父页把 `onRefresh` / `onDeleteRow` / 空态节点都做成稳定引用。
 */
export const DetailResultList = memo(DetailResultListImpl);
