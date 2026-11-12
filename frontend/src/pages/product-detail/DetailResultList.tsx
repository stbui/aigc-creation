import { memo, useMemo, type ReactNode } from 'react';

import { BatchResultCardList } from './components';
import { buildRows, labelOf, type ResultRow } from './utils';
import type { GalleryItem } from './hooks';

/**
 * 商品详情图「创作结果」批次列表。
 *
 * 一次生成 = 一张卡: 商品名 + 时间 / 参数 / 原图 / 各模块图。
 * 与通用网格结果栏的区别是**归组**: 网格把每张图当独立作品,
 * 用户看不出「这 6 张是同一次生成的」。
 *
 * 卡片的信息编排在 `components/BatchResultCardList`(与商品主图共用),
 * 这里只提供详情图的单格名称语义。
 *
 * 数据口径:
 *   - 批次由任务参数 `batchId` 标识, 批内按 `batchIndex` 排序;
 *   - 原图取任务输入素材 (`GalleryItem.inputUrls`), 不是产出素材;
 *   - 没有 batchId 的旧任务 (一次只出一张图) 各自成行, 标签回落到任务 caption。
 */

export interface DetailResultListProps {
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

function DetailResultListImpl({
  items,
  loading,
  error,
  emptyTitle,
  emptyDesc,
  emptyChildren,
  onDeleteRow,
  onRegenerateRow,
  downloadNamePrefix = 'product-detail',
}: DetailResultListProps) {
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

/**
 * memo: 左栏表单每敲一个字都会重渲染整页, 而结果行只随 `items` 变化 ——
 * 历史批次 (每行原图 + 各模块图) 不该跟着输入节奏逐帧重建。
 */
export const DetailResultList = memo(DetailResultListImpl);
