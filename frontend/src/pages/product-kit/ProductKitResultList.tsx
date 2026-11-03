import { memo, useMemo, type ReactNode } from 'react';

import { BatchResultList } from './components';
import { buildRows, labelOf } from './utils';
import type { GalleryItem } from './hooks';

/**
 * 商品主图「创作结果」批次列表。
 *
 * 一次提交 = 一行: 行头是日期与提示词, 行内第一格是上传的原图 (下方标商品名称),
 * 之后每格是一张主图 (下方标白底图 / 场景图 / 卖点图)。与通用结果网格相比,
 * 这里保留了「这套图属于同一次生成」的上下文。
 *
 * 渲染本体在 `components/BatchResultList`(与详情图 / 带货图文共用),
 * 这里只提供商品主图的页面语义: 行头带提示词, 原图格标商品名与张数。
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
  onRefresh: () => void;
  /** 删除一次生成（批次内全部任务） */
  onDeleteRow: (items: GalleryItem[]) => void;
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
  onRefresh,
  onDeleteRow,
  downloadNamePrefix = 'main-image',
}: ProductKitResultListProps) {
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
      sourceCaptionTitle={(row) =>
        row.sourceUrls.length > 1
          ? `${row.productName || '商品原图'}，共 ${row.sourceUrls.length} 张`
          : row.productName
      }
    />
  );
}

/** memo: 左栏表单按键重渲染时, 历史批次只随 `items` 变化重建。 */
export const ProductKitResultList = memo(ProductKitResultListImpl);
