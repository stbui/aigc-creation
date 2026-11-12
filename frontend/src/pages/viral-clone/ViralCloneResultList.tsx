import { memo, useMemo, useState } from 'react';
import {
  CircleAlert,
  Download,
  ImagePlus,
  Images,
  LoaderCircle,
  Maximize2,
  Trash2,
  X,
} from 'lucide-react';

import { assetThumbUrl, toAbsoluteUrl } from './api';
import {
  Button,
  EmptyState,
  EmptyStateContent,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateMedia,
  EmptyStateTitle,
  ImageLightbox,
  InlineAlert,
  InlineAlertDescription,
  Skeleton,
  StatusBadge,
  Surface,
  SurfaceContent,
  SurfaceHeader,
  ToolWorkflowSteps,
  cn,
  formatBatchDate,
  type LightboxItem,
} from './components';
import type { GalleryItem, UploadedImage } from './hooks';
import { downloadExtension, splitCloneInputs, taskErrorText, type PolledResult } from './utils';
import { triggerDownload } from '../../lib/download';

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

/**
 * 爆款复刻「创作结果」对照列表 —— 右栏「创作结果」页签的内容。
 *
 * 复刻页真正需要被比较的是三张图：上传的商品图、被复刻的参考图、最终生成图。
 * 因此这里不再只铺生成图缩略图，而是按任务逐行陈列完整的「上传图 → 参考图 →
 * 生成图」链路；任务生成中和历史回看沿用同一视觉结构。
 *
 * 与商品详情 / 商品主图的右栏共用同一套外壳：`OutputTabsPane` + 白卡结果区，
 * 本文件只负责复刻页特有的对照行与预览，页签落位与取数都在 `page.tsx`。
 *
 * 数据口径：
 * - 历史任务的输入顺序由后端保留为 `[商品图..., 参考图]`，从 `inputUrls` 末位拆参考图；
 * - 用户点击生成后，本次任务使用表单里当前的商品图与参考图；
 * - 生成成功的任务由 `gallery.prepend` 立刻进入首行，不等待历史列表重新拉取。
 */
export interface ViralCloneResultListProps {
  items: GalleryItem[];
  loading: boolean;
  /** 加载失败信息；非空时保留已有列表并提示 */
  error?: string | null;
  submitting: boolean;
  images: UploadedImage[];
  reference: UploadedImage | null;
  /** 本次提交的结果；只在生成中 / 失败时补一行 */
  result: PolledResult | null;
  onDelete: (item: GalleryItem) => void;
  onUseAsReference: (item: GalleryItem) => void;
}

function ViralCloneResultListImpl({
  items,
  loading,
  error,
  submitting,
  images,
  reference,
  result,
  onDelete,
  onUseAsReference,
}: ViralCloneResultListProps) {
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const historyRows = useMemo<CompareRow[]>(() => {
    return items.map((item) => {
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
  }, [items]);

  const resultInGallery =
    result?.status === 'succeeded' &&
    Boolean(result.url) &&
    items.some((item) => item.url === result.url);
  // 成功后由 gallery.prepend 插入的正式记录承接展示；当前行只负责生成中、
  // 失败态，以及结果先于列表更新时的短暂兜底。未点击生成前不展示当前输入。
  const showCurrent =
    submitting ||
    result?.status === 'failed' ||
    (result?.status === 'succeeded' && !resultInGallery);
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
  const showStarter = !loading && rows.length === 0;

  const openPreview = (row: CompareRow, id: string) => {
    const list = previewItemsOf(row);
    const index = list.findIndex((item) => item.id === id);
    if (index >= 0) setPreview({ items: list, index });
  };

  const download = (row: CompareRow) => {
    const item = row.item;
    if (!item?.url) return;
    const ext = downloadExtension(item.format);
    triggerDownload(toAbsoluteUrl(item.url) ?? item.url, `viral-clone-${item.id.slice(-6)}.${ext}`);
  };

  return (
    <section className="pk-result-pane">
      <div className="pk-result-body">
        {error && (
          <InlineAlert variant="destructive" className="vc-result-alert">
            <CircleAlert />
            <InlineAlertDescription>历史生成图加载失败：{error}</InlineAlertDescription>
          </InlineAlert>
        )}
        {result?.status === 'failed' && (
          <InlineAlert variant="destructive" className="vc-result-alert">
            <CircleAlert />
            <InlineAlertDescription>
              本次生成失败：{taskErrorText(result.errorCode)}，可调整后重新生成
            </InlineAlertDescription>
          </InlineAlert>
        )}

        {loading && rows.length === 0 ? (
          <div className="vc-result-loading" role="status" aria-label="正在加载复刻结果">
            <div className="vc-result-loading-grid" aria-hidden>
              <Skeleton className="aspect-square rounded-lg" />
              <Skeleton className="aspect-square rounded-lg" />
              <Skeleton className="aspect-square rounded-lg" />
            </div>
            <span>正在加载复刻记录…</span>
          </div>
        ) : showStarter ? (
          <EmptyState className="vc-result-empty">
            <EmptyStateHeader>
              <EmptyStateMedia variant="icon">
                <Images />
              </EmptyStateMedia>
              <EmptyStateTitle>上传商品图和参考图开始复刻</EmptyStateTitle>
              <EmptyStateDescription>
                每次生成都会保留一组「商品上传图 → 参考图 → 生成图」对照，方便回看与继续调整。
              </EmptyStateDescription>
            </EmptyStateHeader>
            <EmptyStateContent>
              <ToolWorkflowSteps />
            </EmptyStateContent>
          </EmptyState>
        ) : (
          <div className="vc-result-list">
            {rows.map((row) => {
              const isCurrent = row.key === 'current';
              return (
                <Surface className={cn('vc-result-row', isCurrent && 'is-current')} key={row.key}>
                  <SurfaceHeader className="vc-result-row-head">
                    <div className="vc-result-row-meta">
                      {isCurrent && <strong className="text-sm font-semibold">本次复刻</strong>}
                      {row.caption && (
                        <StatusBadge className="vc-degree-badge" variant="secondary">
                          {row.caption}
                        </StatusBadge>
                      )}
                      {row.createdAt && <time dateTime={row.createdAt}>{formatBatchDate(row.createdAt)}</time>}
                    </div>
                    {row.item?.url && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="vc-result-delete-action"
                        aria-label="删除这次复刻结果"
                        title="删除这次复刻结果"
                        onClick={() => onDelete(row.item!)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </SurfaceHeader>

                  <SurfaceContent className="vc-result-row-content">
                    <div className="vc-compare-grid">
                      <figure className="vc-compare-card is-product">
                        <div className="vc-compare-media">
                          {row.productUrls[0] ? (
                            <div className="vc-product-gallery">
                              <Button
                                variant="ghost"
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
                              </Button>
                              {row.productUrls.length > 1 && (
                                <div className="vc-product-rail" role="group" aria-label="其余商品上传图">
                                  {row.productUrls.slice(1, 5).map((url, index) => (
                                    <Button
                                      variant="ghost"
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
                                    </Button>
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
                          </span>
                        </figcaption>
                      </figure>

                      <figure className="vc-compare-card is-reference">
                        <div className="vc-compare-media">
                          {row.referenceUrl ? (
                            <Button
                              variant="ghost"
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
                            </Button>
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
                          </span>
                        </figcaption>
                      </figure>

                      <figure className="vc-compare-card is-output">
                        <div className="vc-compare-media">
                          {row.outputUrl ? (
                            <>
                              <Button
                                variant="ghost"
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
                              </Button>
                              {row.item && (
                                <div className="vc-output-actions">
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label="下载生成图"
                                    title="下载原图"
                                    onClick={() => download(row)}
                                  >
                                    <Download />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label="用作参考图"
                                    title="用作下一轮参考图"
                                    onClick={() => onUseAsReference(row.item!)}
                                  >
                                    <ImagePlus />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label="删除生成图"
                                    title="删除生成图"
                                    onClick={() => onDelete(row.item!)}
                                  >
                                    <Trash2 />
                                  </Button>
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
                          </span>
                        </figcaption>
                      </figure>
                    </div>
                  </SurfaceContent>
                </Surface>
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

/**
 * memo: 左栏表单每敲一个字都会重渲染整页, 而对照行只随 `items` / 本次结果变化 ——
 * 历史行 (三张大图 + 操作钮) 不该跟着输入节奏逐帧重建。
 * 前提是页面把 `onDelete` / `onUseAsReference` 做成稳定引用。
 */
export const ViralCloneResultList = memo(ViralCloneResultListImpl);
