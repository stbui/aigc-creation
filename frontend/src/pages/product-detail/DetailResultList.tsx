import { memo, useMemo, type ReactNode } from 'react';

import { BatchResultList } from './components';
import { buildRows, formatDate, labelOf, resultStatusOf } from './utils';
import type { GalleryItem } from './hooks';

/**
 * 商品详情图「创作结果」批次列表。
 *
 * 一次生成 = 一张卡: 商品名 + 时间 / 参数 + 状态 / 原图 + 一键下载,
 * 之后三列展示本次模块图。这与网格结果栏的区别是**归组**:
 * 网格把每张图当独立作品, 用户看不出「这 6 张是同一次生成的」。
 *
 * 渲染本体在 `components/BatchResultList`(与商品主图 / 带货图文共用),
 * 这里只提供详情图的页面语义, 通用渲染与下载逻辑仍在 `BatchResultList`。
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
  downloadNamePrefix = 'product-detail',
}: DetailResultListProps) {
  const rows = useMemo(() => buildRows(items), [items]);

  return (
    <BatchResultList
      rows={rows}
      loading={loading}
      error={error}
      emptyTitle={emptyTitle}
      emptyDesc={emptyDesc}
      emptyChildren={emptyChildren}
      onDeleteRow={onDeleteRow}
      downloadNamePrefix={downloadNamePrefix}
      labelOf={labelOf}
      layout="card"
      cellLabelOf={(item) => labelOf(item)}
      renderRowTitle={(row) => (
        <div className="pd-result-card-title">
          <strong title={`商品：${row.productName || '未命名商品'}`}>
            商品：{row.productName || '未命名商品'}
          </strong>
          <time dateTime={row.createdAt}>{formatDate(row.createdAt) || '时间未知'}</time>
        </div>
      )}
      renderRowMeta={(row) => {
        const status = resultStatusOf(row.cells);
        const chips = [
          ['resolution', row.meta.resolution],
          ['ratio', row.meta.ratio],
          ['platform', row.meta.platform],
          ['country', row.meta.country],
          ['language', row.meta.language],
        ] as const;
        return (
          <>
            {chips.map(([key, label]) =>
              label ? (
                <span className="pd-result-meta-chip" key={key}>
                  {label}
                </span>
              ) : null,
            )}
            <span className={`pd-result-status is-${status.tone}`}>{status.label}</span>
          </>
        );
      }}
      renderSourceCaption={() => null}
    />
  );
}

/**
 * memo: 左栏表单每敲一个字都会重渲染整页, 而结果行只随 `items` 变化 ——
 * 历史批次 (每行原图 + 各模块图) 不该跟着输入节奏逐帧重建。
 */
export const DetailResultList = memo(DetailResultListImpl);
