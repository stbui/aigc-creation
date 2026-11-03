import { memo, useMemo } from 'react';

import { BatchResultList } from './components';
import { buildRows, labelOf } from './utils';
import type { GalleryItem } from './hooks';

/**
 * 「创作结果」批次列表 = 本站的历史记录区。
 *
 * 一次提交 = 一行: 行头是日期与模板 / 卖点文案, 行内第一格是上传的原图,
 * 之后每格是一张带货图文 (下方标「第 N 张」或拍名)。
 *
 * 渲染本体在 `components/BatchResultList`(与详情图 / 商品主图共用),
 * 这里只提供带货图文的页面语义: 行头带模板与卖点, 原图格用固定文案。
 *
 * 归组逻辑与 `ProductKitResultList` 同源 (batchId 归组 / batchIndex 排序);
 * 差异只在于行头信息与原图格图注, 通过插槽注入, 组件内没有页面分支。
 */

export interface ShoppableCarouselResultListProps {
  items: GalleryItem[];
  loading: boolean;
  error?: string | null;
  emptyTitle: string;
  emptyDesc?: string;
  onRefresh: () => void;
  /** 删除一次生成（批次内全部任务） */
  onDeleteRow: (items: GalleryItem[]) => void;
}

function ShoppableCarouselResultListImpl({
  items,
  loading,
  error,
  emptyTitle,
  emptyDesc,
  onRefresh,
  onDeleteRow,
}: ShoppableCarouselResultListProps) {
  const rows = useMemo(() => buildRows(items), [items]);

  return (
    <BatchResultList
      rows={rows}
      loading={loading}
      error={error}
      title="历史生成记录"
      emptyTitle={emptyTitle}
      emptyDesc={emptyDesc}
      onRefresh={onRefresh}
      onDeleteRow={onDeleteRow}
      downloadNamePrefix="shoppable-carousel"
      labelOf={labelOf}
      renderRowMeta={(row) => (
        <>
          {row.templateName && <span className="pd-result-template">模板：{row.templateName}</span>}
          {row.sellingPoints && (
            <span className="pd-result-prompt" title={row.sellingPoints}>
              卖点：{row.sellingPoints}
            </span>
          )}
        </>
      )}
      renderSourceCaption={(row) => (
        <>
          商品原图
          {row.sourceUrls.length > 1 ? ` · ${row.sourceUrls.length} 张` : ''}
        </>
      )}
      sourceCaptionTitle={() => '上传的商品原图'}
    />
  );
}

/** memo: 左栏表单按键重渲染时, 历史批次只随 `items` 变化重建。 */
export const ShoppableCarouselResultList = memo(ShoppableCarouselResultListImpl);
