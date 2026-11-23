import { Download, ImagePlus, LoaderCircle, Maximize2, RotateCcw, Trash2, X } from 'lucide-react';

import { assetThumbUrl, toAbsoluteUrl } from './api';
import {
  Button,
  Badge,
  Card,
  CardContent,
  CardHeader,
  cn,
  formatBatchDate,
  resultMetaOf,
  resultStatusOf,
  type LightboxItem,
  type ResultMeta,
  type ResultStatusTone,
} from './components';
import type { GalleryItem } from './hooks';

/**
 * 爆款复刻结果列表的「单行对照」。
 *
 * 2026-11-15 从 `ViralCloneResultList` 抽出：主文件此前同时管取样、下载编排、
 * 空态与单行 300 行 JSX。抽成行组件后，列表只负责「有哪些行、下载怎么编排」，
 * 行自己负责「三张图各自怎么显示」。
 *
 * 一行固定三格：商品上传图 → 参考图 → 生成图。生成图按 `state` 分四种呈现
 * （成功 / 失败 / 生成中 / 未开始），另外两格缺失时给可行动的占位文案。
 */
export type CompareState = 'ready' | 'generating' | 'failed' | 'idle';

export interface CompareRow {
  key: string;
  /** 本次提交的行没有 gallery item */
  item?: GalleryItem;
  productUrls: string[];
  referenceUrl: string | null;
  outputUrl: string;
  state: CompareState;
  caption?: string;
  createdAt?: string;
}

/** 行头参数摘要口径与商品主图 / 商品详情的批次卡完全一致 */
const META_KEYS: Array<keyof ResultMeta> = ['resolution', 'ratio', 'platform', 'country', 'language'];

function productNameOf(item?: GalleryItem): string {
  const name = item?.params?.productName;
  return typeof name === 'string' && name.trim() ? name.trim() : '未命名商品';
}

function statusOf(row: CompareRow): { label: string; tone: ResultStatusTone } | null {
  if (row.item) return resultStatusOf([row.item]);
  if (row.state === 'generating') return { label: '生成中', tone: 'processing' };
  if (row.state === 'failed') return { label: '生成失败', tone: 'failed' };
  return null;
}

/** 输入素材 URL 的扩展名; 拿不到时按 PNG 兜底（上传区本来就只收图片） */
export function sourceExtension(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  return /^[a-z0-9]{2,4}$/.test(ext) ? ext : 'png';
}

/**
 * 一行的可预览图集合：商品图 → 参考图 → 生成图，id 带行前缀以便跨行唯一定位。
 */
export function previewItemsOf(row: CompareRow): LightboxItem[] {
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

interface Props {
  row: CompareRow;
  /** 正在打包下载的行 key；用于禁用并标记 aria-busy */
  downloadingRow: string | null;
  onPreview: (row: CompareRow, id: string) => void;
  onDownload: (row: CompareRow) => void;
  onDownloadRow: (row: CompareRow) => void;
  onDownloadSource: (url: string, name: string) => void;
  onDelete: (item: GalleryItem) => void;
  onUseAsReference: (item: GalleryItem) => void;
  onRegenerateRow?: (item: GalleryItem) => void;
}

export function ViralCloneResultRow({
  row,
  downloadingRow,
  onPreview,
  onDownload,
  onDownloadRow,
  onDownloadSource,
  onDelete,
  onUseAsReference,
  onRegenerateRow,
}: Props) {
  const isCurrent = row.key === 'current';
  const status = statusOf(row);
  // 行头参数摘要与商品主图 / 商品详情的批次卡同口径；本次行尚无任务参数
  const meta = row.item ? resultMetaOf(row.item) : null;
  const readyCount = [row.productUrls[0], row.referenceUrl, row.outputUrl].filter(Boolean).length;

  return (
    <Card className={cn('vc-result-row', isCurrent && 'is-current')}>
      <CardHeader className="vc-result-row-head">
        <div className="vc-result-row-main">
          <div className="vc-result-row-meta">
            {isCurrent ? (
              <strong className="text-sm font-semibold">本次复刻</strong>
            ) : (
              <strong className="vc-result-row-title" title={`商品：${productNameOf(row.item)}`}>
                商品：{productNameOf(row.item)}
              </strong>
            )}
            {row.caption && (
              <Badge className="vc-degree-badge" variant="secondary">
                {row.caption}
              </Badge>
            )}
            {status && <span className={`vc-result-status is-${status.tone} u-font-12`}>{status.label}</span>}
            {row.createdAt && <time dateTime={row.createdAt}>{formatBatchDate(row.createdAt)}</time>}
          </div>
          {meta && (
            <div className="vc-result-meta-chips">
              {META_KEYS.map((key) =>
                meta[key] ? (
                  <span className="vc-result-meta-chip u-font-12" key={key}>
                    {meta[key]}
                  </span>
                ) : null,
              )}
            </div>
          )}
        </div>
        <div className="vc-result-actions">
          {row.item && (
            <>
              {onRegenerateRow && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="vc-result-regenerate"
                  aria-label="重新生成这次复刻"
                  title="把这次生成的参数带回左侧"
                  onClick={() => onRegenerateRow(row.item!)}
                >
                  <RotateCcw />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                className="vc-result-download-all"
                aria-label="一键下载这次复刻的全部图片"
                title="打包下载商品图、参考图与生成图"
                aria-busy={downloadingRow === row.key}
                disabled={readyCount === 0 || Boolean(downloadingRow)}
                onClick={() => onDownloadRow(row)}
              >
                <Download />
              </Button>
            </>
          )}
          {row.item && (
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
        </div>
      </CardHeader>

      <CardContent className="vc-result-row-content">
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
                    onClick={() => onPreview(row, `${row.key}:product:0`)}
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
                          onClick={() => onPreview(row, `${row.key}:product:${index + 1}`)}
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
              {row.productUrls.length > 1 && <span className="vc-source-count">共 {row.productUrls.length} 张</span>}
              {row.productUrls.length > 0 && (
                <div className="vc-source-actions">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="下载商品上传图"
                    title="下载商品上传图"
                    onClick={() =>
                      row.productUrls.forEach((url, index) =>
                        onDownloadSource(url, `viral-clone-商品上传图-${index + 1}.${sourceExtension(url)}`),
                      )
                    }
                  >
                    <Download />
                  </Button>
                </div>
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
                  onClick={() => onPreview(row, `${row.key}:reference`)}
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
              {row.referenceUrl && (
                <div className="vc-source-actions">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="下载参考图"
                    title="下载参考图"
                    onClick={() =>
                      onDownloadSource(row.referenceUrl!, `viral-clone-参考图.${sourceExtension(row.referenceUrl!)}`)
                    }
                  >
                    <Download />
                  </Button>
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
                    onClick={() => onPreview(row, `${row.key}:output`)}
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
                        onClick={() => onDownload(row)}
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
      </CardContent>
    </Card>
  );
}
