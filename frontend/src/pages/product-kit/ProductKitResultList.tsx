import { memo, useMemo, type ReactNode } from 'react';

import { BatchResultCardList } from './components';
import { buildRows, labelOf, type ResultRow } from './utils';
import type { GalleryItem } from './hooks';

/**
 * 商品主图「创作结果」批次列表。
 *
 * 一次生成 = 一张卡: 商品名 + 时间 / 参数 / 原图 / 各变体主图。
 * 与通用结果网格相比, 这里保留了「这套图属于同一次生成」的上下文。
 *
 * 卡片的信息编排在 `components/BatchResultCardList`(与商品详情共用),
 * 这里只提供商品主图的单格名称语义。
 *
 * 数据口径:
 *   - 批次由任务参数 `batchId` 标识, 批内按 `batchIndex` 排序;
 *   - 原图取任务输入素材 (`GalleryItem.inputUrls`), 不是产出素材;
 *   - 没有 batchId 的旧任务各自成行, 标签回落到任务 caption。
 */

export interface ProductKitResultListProps {
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
  onRegenerateRow?: (row: ResultRow) => void;
  /** 下载文件名前缀 */
  downloadNamePrefix?: string;
}

function ProductKitResultListImpl({
  items,
  loading,
  error,
  emptyTitle,
  emptyDesc,
  emptyChildren,
  onDeleteRow,
  onRegenerateRow,
  downloadNamePrefix = 'main-image',
}: ProductKitResultListProps) {
  const rows = useMemo(() => buildRows(items), [items]);

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

/** memo: 左栏表单按键重渲染时, 历史批次只随 `items` 变化重建。 */
export const ProductKitResultList = memo(ProductKitResultListImpl);
