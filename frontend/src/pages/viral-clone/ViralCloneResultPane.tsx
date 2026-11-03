import { useMemo, useState } from 'react';
import {
  Download,
  ImagePlus,
  LoaderCircle,
  Maximize2,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';

import type { PkAsset, PkResult } from './constants';
import { assetThumbUrl, toAbsoluteUrl } from './api';
import { ImageLightbox, ToolWorkflowSteps, type LightboxItem } from './components';
import type { GalleryItem, ResultGallery } from './hooks';
import { splitCloneInputs, taskErrorText } from './utils';

type CompareState = 'ready' | 'generating' | 'failed' | 'idle';

interface CompareRow {
  key: string;
  item?: GalleryItem;
  productUrls: string[];
  referenceUrl: string | null;
  outputUrl: string;
  state: CompareState;
  caption?: string;
  createdAt?: string;
}

interface PreviewState {
  items: LightboxItem[];
  index: number;
}

function previewItemsOf(row: CompareRow): LightboxItem[] {
  const list: LightboxItem[] = [];
  row.productUrls.forEach((url, index) => {
    list.push({
      id: `${row.key}:product:${index}`,
      url,
      alt: row.productUrls.length > 1 ? `商品上传图 ${index + 1}` : '商品上传图',
      meta: [row.productUrls.length > 1 ? `商品上传图 ${index + 1}` : '商品上传图'],
    });
  });
  if (row.referenceUrl) {
    list.push({
      id: `${row.key}:reference`,
      url: row.referenceUrl,
      alt: '参考图',
      meta: ['参考图'],
    });
  }
  if (row.outputUrl) {
    list.push({
      id: `${row.key}:output`,
      url: row.outputUrl,
      alt: row.caption ? `${row.caption}生成图` : '生成图',
      width: row.item?.width,
      height: row.item?.height,
      createdAt: row.createdAt,
      meta: [row.caption || '复刻生成图'],
    });
  }
  return list;
}

function formatTime(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function stateText(state: CompareState): string {
  if (state === 'generating') return '生成中';
  if (state === 'failed') return '生成失败';
  if (state === 'ready') return '已完成';
  return '待生成';
}

/**
 * 爆款复刻右侧结果栏。
 *
 * 复刻页真正需要被比较的是三张图：上传的商品图、被复刻的参考图、最终生成图。
 * 因此这里不再只铺生成图缩略图，而是按任务逐行陈列完整的「上传图 → 参考图 →
 * 生成图」链路；页面刚上传、任务生成中和历史回看都沿用同一视觉结构。
 *
 * 数据口径：
 * - 历史任务的输入顺序由后端保留为 `[商品图..., 参考图]`，从 `inputUrls` 末位拆参考图；
 * - 本次提交尚未完成时，直接使用表单里当前的商品图与参考图；
 * - 生成成功的任务由 `gallery.prepend` 立刻进入首行，不等待历史列表重新拉取。
 */
export function ViralCloneResultPane({
  gallery,
  generating,
  submitting,
  images,
  reference,
  result,
  onRefresh,
  onDelete,
  onUseAsReference,
}: {
  gallery: Pick<ResultGallery, 'items' | 'loading' | 'error' | 'reload'>;
  generating: boolean;
  submitting: boolean;
  images: PkAsset[];
  reference: PkAsset | null;
  result: PkResult | null;
  onRefresh: () => void;
  onDelete: (item: GalleryItem) => void;
  onUseAsReference: (item: GalleryItem) => void;
}) {
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const historyRows = useMemo<CompareRow[]>(() => {
    return gallery.items.map((item) => {
      const inputs = splitCloneInputs(item.inputUrls);
      const state: CompareState = item.url
        ? 'ready'
        : item.status === 'failed' || item.status === 'cancelled'
          ? 'failed'
          : 'generating';
      return {
        key: item.id,
        item,
        productUrls: inputs.productUrls,
        referenceUrl: inputs.referenceUrl,
        outputUrl: item.url,
        state,
        caption: item.caption,
        createdAt: item.createdAt,
      };
    });
  }, [gallery.items]);

  const resultInGallery =
    result?.status === 'succeeded' &&
    Boolean(result.url) &&
    gallery.items.some((item) => item.url === result.url);
  // 成功后由 gallery.prepend 插入的正式记录承接展示；当前行只负责草稿、
  // 生成中和失败态。结果状态先于列表更新时仍由当前行兜底，避免短暂空白。
  const showCurrent =
    submitting ||
    result?.status === 'failed' ||
    (result?.status === 'succeeded'
      ? !resultInGallery && (images.length > 0 || reference !== null)
      : !result && (images.length > 0 || reference !== null));
  const currentRow = useMemo<CompareRow>(
    () => ({
      key: 'current',
      productUrls: images.map((image) => image.url).filter(Boolean),
      referenceUrl: reference?.url || null,
      outputUrl: result?.status === 'succeeded' ? result.url || '' : '',
      state: submitting
        ? 'generating'
        : result?.status === 'failed'
          ? 'failed'
          : result?.status === 'succeeded'
            ? 'ready'
            : 'idle',
    }),
    [images, reference, result, submitting],
  );

  const rows = showCurrent ? [currentRow, ...historyRows] : historyRows;
  const showStarter = !gallery.loading && rows.length === 0;
  const readyCount = historyRows.filter((row) => row.state === 'ready').length;

  const openPreview = (row: CompareRow, id: string) => {
    const items = previewItemsOf(row);
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) setPreview({ items, index });
  };

  const download = (row: CompareRow) => {
    const item = row.item;
    if (!item?.url) return;
    const ext = (item.format || 'png').toLowerCase().replace(/^\./, '') || 'png';
    const link = document.createElement('a');
    link.href = toAbsoluteUrl(item.url) ?? item.url;
    link.download = `viral-clone-${item.id.slice(-6)}.${ext}`;
    link.click();
  };

  return (
    <section className="pk-result-pane vc-result-pane">
      <div className="pk-result-body vc-result-body">
        <div className="pk-result-toolbar">
          <div className="pk-result-title">
            复刻结果
            <span className="pk-result-count">
              {generating ? '正在生成' : historyRows.length > 0 ? `${historyRows.length} 次 · ${readyCount} 张` : '等待生成'}
            </span>
          </div>
          <button type="button" className="pk-result-regen" disabled={gallery.loading} onClick={onRefresh}>
            <RefreshCw size={13} />
            {gallery.loading ? '刷新中' : '刷新'}
          </button>
        </div>

        {gallery.error && (
          <p className="tool-submit-notice tool-submit-notice-error">历史生成图加载失败：{gallery.error}</p>
        )}
        {result?.status === 'failed' && (
          <p className="tool-submit-notice tool-submit-notice-error">
            本次生成失败：{taskErrorText(result.errorCode)}，可调整后重新生成
          </p>
        )}

        {gallery.loading && rows.length === 0 ? (
          <div className="vc-result-loading" role="status" aria-label="正在加载复刻结果">
            <LoaderCircle size={22} className="vc-spin" />
            <span>正在加载复刻记录…</span>
          </div>
        ) : (
          <div className="vc-result-list">
            {showStarter && (
              <div className="vc-result-starter">
                <div className="vc-result-starter-copy">
                  <strong>上传商品图和参考图，生成结果会显示在这里</strong>
                  <p>每次生成都会保留一组对照，方便回看商品、参考图和最终成品。</p>
                </div>
                <ToolWorkflowSteps />
              </div>
            )}

            {(showStarter ? [currentRow] : rows).map((row) => {
              const rowPreview = previewItemsOf(row);
              const isCurrent = row.key === 'current';
              return (
                <article className={`vc-result-row${isCurrent ? ' is-current' : ''}`} key={row.key}>
                  <header className="vc-result-row-head">
                    <div className="vc-result-row-meta">
                      <span className={`vc-result-state is-${row.state}`}>
                        {row.state === 'generating' && <LoaderCircle size={12} className="vc-spin" />}
                        {stateText(row.state)}
                      </span>
                      <strong>{isCurrent ? '本次复刻' : '复刻记录'}</strong>
                      {row.caption && <span className="vc-result-degree">{row.caption}</span>}
                      {row.createdAt && <time dateTime={row.createdAt}>{formatTime(row.createdAt)}</time>}
                    </div>
                    {row.item?.url && (
                      <button
                        type="button"
                        className="vc-result-delete"
                        aria-label="删除这次复刻结果"
                        title="删除这次复刻结果"
                        onClick={() => onDelete(row.item!)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </header>

                  <div className="vc-compare-grid">
                    <figure className="vc-compare-card is-product">
                      <div className="vc-compare-media">
                        {row.productUrls[0] ? (
                          <div className="vc-product-gallery">
                            <button
                              type="button"
                              className="vc-compare-open"
                              aria-label="查看商品上传图 1 大图"
                              title="查看商品上传图 1 大图"
                              onClick={() => openPreview(row, `${row.key}:product:0`)}
                            >
                              <img
                                src={assetThumbUrl(row.productUrls[0], 720) ?? toAbsoluteUrl(row.productUrls[0])}
                                alt="商品上传图 1"
                                loading={isCurrent ? 'eager' : 'lazy'}
                              />
                              <span className="vc-compare-open-mask">
                                <Maximize2 size={16} />
                              </span>
                            </button>
                            {row.productUrls.length > 1 && (
                              <div className="vc-product-rail" role="group" aria-label="其余商品上传图">
                                {row.productUrls.slice(1, 5).map((url, index) => (
                                  <button
                                    type="button"
                                    className="vc-compare-open"
                                    aria-label={`查看商品上传图 ${index + 2} 大图`}
                                    title={`查看商品上传图 ${index + 2} 大图`}
                                    key={`${row.key}:product:${index + 1}`}
                                    onClick={() => openPreview(row, `${row.key}:product:${index + 1}`)}
                                  >
                                    <img
                                      src={assetThumbUrl(url, 240) ?? toAbsoluteUrl(url)}
                                      alt={`商品上传图 ${index + 2}`}
                                      loading={isCurrent ? 'eager' : 'lazy'}
                                    />
                                    <span className="vc-compare-open-mask">
                                      <Maximize2 size={12} />
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="vc-compare-placeholder">
                            <ImagePlus size={22} />
                            <span>在上传区添加商品图</span>
                          </div>
                        )}
                        {row.productUrls.length > 1 && (
                          <span className="vc-source-count">共 {row.productUrls.length} 张</span>
                        )}
                      </div>
                      <figcaption className="vc-compare-caption">
                        <span className="vc-compare-step">1</span>
                        <span>
                          <strong>商品上传图</strong>
                          <small>{row.productUrls.length > 1 ? `已上传 ${row.productUrls.length} 张，点击看全部` : '你的商品素材'}</small>
                        </span>
                      </figcaption>
                    </figure>

                    <figure className="vc-compare-card is-reference">
                      <div className="vc-compare-media">
                        {row.referenceUrl ? (
                          <button
                            type="button"
                            className="vc-compare-open"
                            aria-label="查看参考图大图"
                            title="查看参考图大图"
                            onClick={() => openPreview(row, `${row.key}:reference`)}
                          >
                            <img
                              src={assetThumbUrl(row.referenceUrl, 720) ?? toAbsoluteUrl(row.referenceUrl)}
                              alt="参考图"
                              loading={isCurrent ? 'eager' : 'lazy'}
                            />
                            <span className="vc-compare-open-mask">
                              <Maximize2 size={16} />
                            </span>
                          </button>
                        ) : (
                          <div className="vc-compare-placeholder">
                            <ImagePlus size={22} />
                            <span>在上传区添加参考图</span>
                          </div>
                        )}
                      </div>
                      <figcaption className="vc-compare-caption">
                        <span className="vc-compare-step">2</span>
                        <span>
                          <strong>参考图</strong>
                          <small>构图、场景与风格来源</small>
                        </span>
                      </figcaption>
                    </figure>

                    <figure className="vc-compare-card is-output">
                      <div className="vc-compare-media">
                        {row.outputUrl ? (
                          <>
                            <button
                              type="button"
                              className="vc-compare-open"
                              aria-label="查看生成图大图"
                              title="查看生成图大图"
                              onClick={() => openPreview(row, `${row.key}:output`)}
                            >
                              <img
                                src={assetThumbUrl(row.outputUrl, 720) ?? toAbsoluteUrl(row.outputUrl)}
                                alt={row.caption ? `${row.caption}生成图` : '生成图'}
                                loading={isCurrent ? 'eager' : 'lazy'}
                              />
                              <span className="vc-compare-open-mask">
                                <Maximize2 size={16} />
                              </span>
                            </button>
                            {row.item && (
                              <div className="vc-output-actions">
                                <button
                                  type="button"
                                  aria-label="下载生成图"
                                  title="下载原图"
                                  onClick={() => download(row)}
                                >
                                  <Download size={14} />
                                </button>
                                <button
                                  type="button"
                                  aria-label="用作参考图"
                                  title="用作下一轮参考图"
                                  onClick={() => onUseAsReference(row.item!)}
                                >
                                  <ImagePlus size={14} />
                                </button>
                                <button
                                  type="button"
                                  aria-label="删除生成图"
                                  title="删除生成图"
                                  onClick={() => onDelete(row.item!)}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            )}
                          </>
                        ) : row.state === 'failed' ? (
                          <div className="vc-compare-placeholder is-failed">
                            <X size={22} />
                            <span>生成失败</span>
                          </div>
                        ) : row.state === 'generating' ? (
                          <div className="vc-compare-placeholder is-generating" role="status">
                            <LoaderCircle size={24} className="vc-spin" />
                            <span>正在复刻，请稍候…</span>
                          </div>
                        ) : (
                          <div className="vc-compare-placeholder">
                            <ImagePlus size={22} />
                            <span>生成后在此显示</span>
                          </div>
                        )}
                      </div>
                      <figcaption className="vc-compare-caption">
                        <span className="vc-compare-step">3</span>
                        <span>
                          <strong>生成图</strong>
                          <small>{row.state === 'ready' ? '点击预览或下载原图' : stateText(row.state)}</small>
                        </span>
                      </figcaption>
                    </figure>
                  </div>

                  {rowPreview.length > 0 && <span className="vc-result-preview-hint">点击任意图片可对照查看大图</span>}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {preview && preview.items.length > 0 && (
        <ImageLightbox
          items={preview.items}
          index={Math.min(preview.index, preview.items.length - 1)}
          ariaLabel="爆款复刻对照预览"
          onIndexChange={(index) => setPreview((prev) => (prev ? { ...prev, index } : prev))}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  );
}
