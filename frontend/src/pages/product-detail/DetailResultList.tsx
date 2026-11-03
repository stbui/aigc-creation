import { memo, useMemo, type ReactNode } from 'react';

import { BatchResultList } from './components';
import { buildRows, labelOf } from './utils';
import type { GalleryItem } from './hooks';

/**
 * 商品详情图「创作结果」批次列表。
 *
 * 一次生成 = 一行: 行头是日期与提示词, 行内第一格是上传的原图 (下方标商品名称),
 * 之后每格是一张模块图 (下方标模块名称)。这与网格结果栏的区别是**归组**:
 * 网格把每张图当独立作品, 用户看不出「这 6 张是同一次生成的」。
 *
 * 渲染本体在 `components/BatchResultList`(与商品主图 / 带货图文共用),
 * 这里只提供详情图的页面语义: 行头带提示词, 原图格标商品名而非固定文案。
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
  onRefresh: () => void;
  /** 删除一次生成（批次内全部任务） */
  onDeleteRow: (items: GalleryItem[]) => void;
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
  onRefresh,
  onDeleteRow,
  downloadNamePrefix = 'product-detail',
}: DetailResultListProps) {
  const rows = useMemo(() => buildRows(items), [items]);

  return (
    <BatchResultList
      rows={rows}
      loading={loading}
      error={error}
      title="生成记录"
      emptyTitle={emptyTitle}
      emptyDesc={emptyDesc}
      emptyChildren={emptyChildren}
      onRefresh={onRefresh}
      onDeleteRow={onDeleteRow}
      downloadNamePrefix={downloadNamePrefix}
      labelOf={labelOf}
      renderRowMeta={(row) =>
        row.prompt ? (
          <span className="pd-result-prompt" title={row.prompt}>
            提示词：{row.prompt}
          </span>
        ) : null
      }
      renderSourceCaption={(row) => (
        <>
          {row.productName || '商品原图'}
          {row.sourceUrls.length > 1 ? ` · ${row.sourceUrls.length} 张` : ''}
        </>
      )}
      sourceCaptionTitle={(row) => row.productName}
    />
  );
}

/**
 * memo: 左栏表单每敲一个字都会重渲染整页, 而结果行只随 `items` 变化 ——
 * 历史批次 (每行原图 + 各模块图) 不该跟着输入节奏逐帧重建。
 */
export const DetailResultList = memo(DetailResultListImpl);
