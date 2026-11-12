import type { ReactNode } from 'react';

import {
  SkuHistoryPane,
  SkuResultPanel,
  ToolShell,
  type SkuRegion,
  type ToolAsset,
  type ToolSettings,
} from './components';
import type { SkuBatchResult } from './constants';
import { useCreditCost, type GalleryItem } from './hooks';
import type { SkuBatchGroup } from './utils';

interface ProductSkuWorkspaceProps {
  template: ToolAsset | null;
  regions: SkuRegion[];
  itemCount: number;
  settingsSeed: number;
  defaultRatio: string;
  defaultResolution: string;
  validationMessage: string | null;
  submitting: boolean;
  formValid: boolean;
  onSubmit: (inputs: ToolAsset[], settings: ToolSettings) => Promise<void>;
  batchItems: SkuBatchResult[];
  galleryLoading: boolean;
  galleryError: string | null;
  failedNotice: string | null;
  activeResultId: string | null;
  onActiveResultChange: (id: string | null) => void;
  onRefresh: () => void;
  onRetryFailed: (itemId?: string) => void;
  onDownloadAll: () => void;
  historyGroups: SkuBatchGroup[];
  onOpenHistory: (group: SkuBatchGroup) => void;
  onRestoreHistory: (group: SkuBatchGroup) => void;
  onDownloadHistory: (group: SkuBatchGroup) => void;
  children: ReactNode;
}

/**
 * SKU 页的 ToolShell 编排：左表单 / 右结果 / 尾部历史。
 *
 * 批次状态仍在 `page.tsx`，这里只把面板拼起来，避免页面文件继续膨胀。
 */
export function ProductSkuWorkspace({
  template,
  regions,
  itemCount,
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
  onDownloadAll,
  historyGroups,
  onOpenHistory,
  onRestoreHistory,
  onDownloadHistory,
  children,
}: ProductSkuWorkspaceProps) {
  /*
   * 每个 SKU 各建一条任务、各扣一份单价 —— 按钮上按数量折算总价，
   * 单价取 `GET /capabilities` 的运行时生效价，与建单扣费同源。
   */
  const skuCount = Math.max(itemCount, 1);
  const unitCreditCost = useCreditCost('sku_image');
  const creditLabel =
    unitCreditCost == null
      ? undefined
      : unitCreditCost > 0
        ? `本次消耗 ${unitCreditCost * skuCount} 积分`
        : '免费';

  return (
    <ToolShell
      key={`sku-${settingsSeed}`}
      capability="sku_image"
      pageClass="product-sku-page"
      title="商品SKU图"
      desc="一张图，批量套出版式完全一致的整组 SKU 图。"
      upload={null}
      settings={{ ratio: true, resolution: true, defaultRatio, defaultResolution }}
      submitLabel={`生成SKU图 × ${skuCount}`}
      creditLabel={creditLabel}
      emptyDesc="上传模板图、框选变体区域并编辑 SKU 清单后，批量结果会显示在这里"
      hint={validationMessage ?? undefined}
      formValid={formValid}
      submitting={submitting}
      result={null}
      onSubmit={onSubmit}
      resultPane={
        <SkuResultPanel
          items={batchItems}
          source={
            template
              ? {
                  url: template.url,
                  label: template.name,
                  regions: regions.map((region) => ({
                    id: region.id,
                    x: region.x,
                    y: region.y,
                    width: region.width,
                    height: region.height,
                    type: region.type,
                  })),
                }
              : null
          }
          error={galleryError}
          notice={failedNotice}
          activeId={activeResultId}
          onActiveChange={onActiveResultChange}
          onDownloadAll={onDownloadAll}
          onRetryFailed={onRetryFailed}
          retrying={submitting}
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
          onRetry={onRefresh}
        />
      }
    >
      {children}
    </ToolShell>
  );
}
