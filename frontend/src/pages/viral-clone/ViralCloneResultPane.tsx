import { useMemo, useState } from 'react';
import {
  CircleAlert,
  Download,
  ImagePlus,
  Images,
  LoaderCircle,
  Maximize2,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';

import type { PkAsset, PkResult } from './constants';
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
  Separator,
  Skeleton,
  StatusBadge,
  Surface,
  SurfaceAction,
  SurfaceContent,
  SurfaceHeader,
  SurfaceTitle,
  ToolWorkflowSteps,
  cn,
  type LightboxItem,
} from './components';
import type { GalleryItem, ResultGallery } from './hooks';
import { downloadExtension, splitCloneInputs, taskErrorText } from './utils';

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
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(' ');
}

/**
 * 爆款复刻右侧结果栏。
 *
 * 复刻页真正需要被比较的是三张图：上传的商品图、被复刻的参考图、最终生成图。
 * 因此这里不再只铺生成图缩略图，而是按任务逐行陈列完整的「上传图 → 参考图 →
 * 生成图」链路；任务生成中和历史回看沿用同一视觉结构。
 *
 * 数据口径：
 * - 历史任务的输入顺序由后端保留为 `[商品图..., 参考图]`，从 `inputUrls` 末位拆参考图；
 * - 用户点击生成后，本次任务使用表单里当前的商品图与参考图；
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
    const ext = downloadExtension(item.format);
    const link = document.createElement('a');
    link.href = toAbsoluteUrl(item.url) ?? item.url;
    link.download = `viral-clone-${item.id.slice(-6)}.${ext}`;
    link.click();
  };

  return (
    <Surface className="vc-result-pane">
      <SurfaceHeader className="vc-result-header">
        <div className="flex min-w-0 flex-col gap-1">
          <SurfaceTitle className="flex flex-wrap items-center gap-2 text-base">
            复刻结果
            <StatusBadge variant="secondary">
              {generating ? '正在生成' : historyRows.length > 0 ? `${historyRows.length} 次 · ${readyCount} 张` : '等待生成'}
            </StatusBadge>
          </SurfaceTitle>
        </div>
        <SurfaceAction>
          <Button variant="outline" size="sm" disabled={gallery.loading} onClick={onRefresh}>
            <RefreshCw className={gallery.loading ? 'vc-spin' : undefined} />
            {gallery.loading ? '刷新中' : '刷新'}
          </Button>
        </SurfaceAction>
      </SurfaceHeader>

      <Separator />

      <SurfaceContent className="vc-result-content">
        {gallery.error && (
          <InlineAlert variant="destructive" className="vc-result-alert">
            <CircleAlert />
            <InlineAlertDescription>历史生成图加载失败：{gallery.error}</InlineAlertDescription>
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

        {gallery.loading && rows.length === 0 ? (
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
                      {row.caption && <StatusBadge className="vc-degree-badge" variant="secondary">{row.caption}</StatusBadge>}
                      {row.createdAt && <time dateTime={row.createdAt}>{formatTime(row.createdAt)}</time>}
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
      </SurfaceContent>

      {preview && preview.items.length > 0 && (
        <ImageLightbox
          items={preview.items}
          index={Math.min(preview.index, preview.items.length - 1)}
          ariaLabel="爆款复刻对照预览"
          onIndexChange={(index) => setPreview((prev) => (prev ? { ...prev, index } : prev))}
          onClose={() => setPreview(null)}
        />
      )}
    </Surface>
  );
}
