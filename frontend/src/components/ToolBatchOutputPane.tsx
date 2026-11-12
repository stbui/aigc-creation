import { memo, useMemo, type ReactNode } from 'react';

import { BatchResultCardList } from './BatchResultCardList';
import { OutputTabsPane, type OutputTab } from './OutputTabsPane';
import { buildProductBatchRows, type ProductBatchRow } from './batchResult';
import type { GalleryItem } from '../hooks/useResultGallery';

export interface ToolBatchResultListProps {
  items: GalleryItem[];
  loading: boolean;
  /** 加载失败信息; 非空时保留已有列表并提示 */
  error?: string | null;
  emptyTitle: string;
  emptyDesc?: string;
  emptyChildren?: ReactNode;
  /** 删除一次生成（批次内全部任务） */
  onDeleteRow: (items: GalleryItem[]) => void;
  /** 重新生成：把这次生成的参数回填左栏表单 */
  onRegenerateRow?: (row: ProductBatchRow) => void;
  /** 单格名称（模块名 / 主图变体名） */
  labelOf: (item: GalleryItem) => string;
  /** 下载文件名前缀 */
  downloadNamePrefix: string;
}

/**
 * 批次结果列表 —— 商品主图 / 商品详情共用。
 *
 * 「一次生成 = 一行」的归组与卡片信息编排在 `batchResult` / `BatchResultCardList`
 * 里定义一次；本组件只把页面提供的单格名称语义接进去。
 * `memo` 隔离左栏表单的按键重渲染：历史批次只随 `items` / `labelOf` 变化重建。
 */
function ToolBatchResultListImpl({
  items,
  loading,
  error,
  emptyTitle,
  emptyDesc,
  emptyChildren,
  onDeleteRow,
  onRegenerateRow,
  labelOf,
  downloadNamePrefix,
}: ToolBatchResultListProps) {
  const rows = useMemo(() => buildProductBatchRows(items), [items]);

  return (
    <BatchResultCardList
      rows={rows}
      loading={loading}
      error={error}
      emptyTitle={emptyTitle}
      emptyDesc={emptyDesc}
      emptyChildren={emptyChildren}
      onDeleteRow={onDeleteRow}
      onRegenerateRow={onRegenerateRow}
      labelOf={labelOf}
      downloadNamePrefix={downloadNamePrefix}
    />
  );
}

export const ToolBatchResultList = memo(ToolBatchResultListImpl);

export interface ToolBatchOutputPaneProps extends Omit<ToolBatchResultListProps, 'emptyTitle'> {
  rightTab: OutputTab;
  onPickTab: (tab: OutputTab) => void;
  /** 页签角标：按生成次数计，与下方批次行数一致 */
  generationCount: number;
  /** 功能示例面板 */
  demo: ReactNode;
}

/**
 * 左栏输入 / 右栏「功能示例 + 创作结果」工作台的右栏 —— 商品主图 / 商品详情共用。
 *
 * 右栏不取数：结果轮询与页签落位都在页面，本组件只做结构与页签。
 */
export function ToolBatchOutputPane({
  rightTab,
  onPickTab,
  generationCount,
  demo,
  ...resultProps
}: ToolBatchOutputPaneProps) {
  return (
    <OutputTabsPane
      value={rightTab}
      onChange={onPickTab}
      generationCount={generationCount}
      demo={demo}
      results={<ToolBatchResultList {...resultProps} emptyTitle="效果图预览" />}
    />
  );
}
