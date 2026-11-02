import type { ReactNode } from 'react';

import {
  SkuHistoryPane,
  SkuResultPanel,
  ToolShell,
  type ToolAsset,
  type ToolSettings,
} from './components';
import type { SkuBatchResult } from './constants';
import type { GalleryItem } from './hooks';
import type { SkuBatchGroup } from './utils';
import { downloadDirect } from './utils';

/**
 * SKU 页的 ToolShell 编排：左表单 / 右结果 / 尾部历史。
 *
 * 批次状态仍在 `page.tsx`，这里只把面板拼起来，避免页面文件继续膨胀。
 */
export function ProductSkuWorkspace({
  settingsSeed,
  defaultRatio,
  defaultResolution,
  validationMessage,
  submitting,
  formValid,
  onSubmit,
  batchItems,
  galleryLoading,
  galleryError,
  failedNotice,
  activeResultId,
  onActiveResultChange,
  onRefresh,
  onRetryFailed,
  batchDownloading,
  onDownloadAll,
  historyGroups,
  onOpenHistory,
  onRestoreHistory,
  onDownloadHistory,
  onDeleteHistory,
  children,
}: {
  settingsSeed: number;
  defaultRatio: string;
  defaultResolution: string;
  validationMessage: string | null;
  submitting: boolean;
  formValid: boolean;
  onSubmit: (inputs: ToolAsset[], settings: ToolSettings) => void;
  batchItems: SkuBatchResult[];
  galleryLoading: boolean;
  galleryError: string | null;
  failedNotice: string | null;
  activeResultId: string | null;
  onActiveResultChange: (id: string | null) => void;
  onRefresh: () => void;
  onRetryFailed: (itemId?: string) => void;
  batchDownloading: boolean;
  onDownloadAll: () => void;
  historyGroups: SkuBatchGroup[];
  onOpenHistory: (group: SkuBatchGroup) => void;
  onRestoreHistory: (group: SkuBatchGroup) => void;
  onDownloadHistory: (group: SkuBatchGroup) => void;
  onDeleteHistory: (group: SkuBatchGroup) => void;
  children: ReactNode;
}) {
  return (
    <ToolShell
      key={`sku-${settingsSeed}`}
      capability="sku_image"
      pageClass="product-sku-page"
      title="商品SKU图"
      desc="一张图，批量套出版式完全一致的整组 SKU 图。"
      upload={null}
      settings={{ ratio: true, resolution: true, defaultRatio, defaultResolution }}
      submitLabel="立即生成"
      emptyDesc="上传模板图、框选变体区域并编辑 SKU 清单后，批量结果会显示在这里"
      hint={validationMessage ?? undefined}
      formValid={formValid}
      submitting={submitting}
      result={null}
      onSubmit={onSubmit}
      resultPane={
        <SkuResultPanel
          items={batchItems}
          loading={galleryLoading}
          error={galleryError}
          notice={failedNotice}
          activeId={activeResultId}
          onActiveChange={onActiveResultChange}
          onRefresh={onRefresh}
          onDownload={downloadDirect}
          onDownloadAll={onDownloadAll}
          onRetryFailed={onRetryFailed}
          retrying={submitting || batchDownloading}
        />
      }
      trailingPane={
        <SkuHistoryPane
          items={historyGroups}
          loading={galleryLoading}
          error={galleryError}
          activeId={activeResultId}
          onOpen={onOpenHistory}
          onRestore={onRestoreHistory}
          onDownload={onDownloadHistory}
          onDelete={onDeleteHistory}
          onRetry={onRefresh}
        />
      }
    >
      {children}
    </ToolShell>
  );
}
