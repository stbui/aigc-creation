import { memo, useMemo, useState } from 'react';
import { CircleAlert, Images } from 'lucide-react';

import { toAbsoluteUrl } from './api';
import {
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
  ToolWorkflowSteps,
  type LightboxItem,
} from './components';
import type { GalleryItem, UploadedImage } from './hooks';
import {
  downloadExtension,
  downloadUrlsAsZip,
  splitCloneInputs,
  taskErrorText,
  type PolledResult,
} from './utils';
import { triggerDownload } from '../../lib/download';
import {
  ViralCloneResultRow,
  previewItemsOf,
  sourceExtension,
  type CompareRow,
  type CompareState,
} from './ViralCloneResultRow';

interface PreviewState {
  items: LightboxItem[];
  index: number;
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
  /** 本次任务 id；失败任务已被 gallery 收录后不再重复渲染占位行与失败提示 */
  currentTaskId?: string | null;
  onDelete: (item: GalleryItem) => void;
  onUseAsReference: (item: GalleryItem) => void;
  /** 重新生成：把这次历史生成的参数回填到左栏（与商品主图 / 商品详情一致） */
  onRegenerateRow?: (item: GalleryItem) => void;
}

function ViralCloneResultListImpl({
  items,
  loading,
  error,
  submitting,
  images,
  reference,
  result,
  currentTaskId,
  onDelete,
  onUseAsReference,
  onRegenerateRow,
}: ViralCloneResultListProps) {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  /** 正在打包下载的批次 key，防止重复点击生成多个 zip */
  const [downloadingRow, setDownloadingRow] = useState<string | null>(null);

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
  /*
   * 失败任务现在也会进 gallery（与商品主图 / 商品详情同口径）。gallery 轮询到
   * 这条正式失败行后，占位行和顶部失败提示都要撤下，否则同一次失败显示两次。
   */
  const failedInGallery =
    result?.status === 'failed' &&
    Boolean(currentTaskId && items.some((item) => item.id === currentTaskId));
  const showFailureNotice = result?.status === 'failed' && !failedInGallery;
  // 成功后由 gallery.prepend 插入的正式记录承接展示；当前行只负责生成中、
  // 失败态，以及结果先于列表更新时的短暂兜底。未点击生成前不展示当前输入。
  const showCurrent =
    submitting ||
    (result?.status === 'failed' && !failedInGallery) ||
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

  /** 打包下载「商品图 + 参考图 + 生成图」；单张时直下，多张走 ZIP（与批次卡一致）。 */
  const downloadRow = async (row: CompareRow) => {
    if (downloadingRow) return;
    const files = [
      ...row.productUrls.map((url, index) => ({
        name: `01-商品上传图-${index + 1}.${sourceExtension(url)}`,
        url,
      })),
      ...(row.referenceUrl
        ? [{ name: `02-参考图.${sourceExtension(row.referenceUrl)}`, url: row.referenceUrl }]
        : []),
      ...(row.outputUrl
        ? [
            {
              name: `03-生成图.${downloadExtension(row.item?.format)}`,
              url: row.outputUrl,
            },
          ]
        : []),
    ];
    if (files.length === 0) return;

    const absolute = (url: string) => toAbsoluteUrl(url) ?? url;
    if (files.length === 1) {
      triggerDownload(absolute(files[0].url), `viral-clone-${row.key.slice(-6)}-${files[0].name}`);
      return;
    }

    setDownloadingRow(row.key);
    try {
      await downloadUrlsAsZip(
        `viral-clone-${new Date().toISOString().slice(0, 10)}.zip`,
        files.map((file) => ({ name: file.name, url: absolute(file.url) })),
      );
    } catch {
      // 云端资源未开放 CORS 时 fetch 打包会失败；退回逐张下载，不阻断用户。
      files.forEach((file, index) => {
        window.setTimeout(() => triggerDownload(absolute(file.url), file.name), index * 180);
      });
    } finally {
      setDownloadingRow(null);
    }
  };

  /** 单格下载（商品图 / 参考图），与生成图的下载按钮同口径。 */
  const downloadSource = (url: string, name: string) => {
    triggerDownload(toAbsoluteUrl(url) ?? url, name);
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
        {showFailureNotice && (
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
            {rows.map((row) => (
              <ViralCloneResultRow
                key={row.key}
                row={row}
                downloadingRow={downloadingRow}
                onPreview={openPreview}
                onDownload={download}
                onDownloadRow={(next) => void downloadRow(next)}
                onDownloadSource={downloadSource}
                onDelete={onDelete}
                onUseAsReference={onUseAsReference}
                onRegenerateRow={onRegenerateRow}
              />
            ))}
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
