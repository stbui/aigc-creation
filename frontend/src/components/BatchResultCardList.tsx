import type { ReactNode } from 'react';

import { BatchResultList } from './BatchResultList';
import {
  formatBatchDate,
  resultStatusOf,
  type BatchCardRow,
} from './batchResult';
import type { GalleryItem } from '../hooks/useResultGallery';

/**
 * 批次结果「卡片」列表 —— 商品详情 / 商品主图共用。
 *
 * 一次生成 = 一张卡：标题（商品名 + 时间）/ 参数摘要 / 原图 / 各格产出。
 * 与 `BatchResultList` 的职责分工：
 *   - `BatchResultList` 负责行、格、下载、删除、重新生成等交互；
 *   - 本文件只提供两页完全一致的卡片信息编排（标题与参数行），
 *     页面差异只剩单格名称 `labelOf` 与下载前缀。
 *
 * 2026-11-12 抽取：商品主图要求右栏与商品详情一致，若各自复制一份
 * 标题 / 参数 / 状态渲染，两页很快会再次分叉（三份拷贝曾是 833 行）。
 */
export interface BatchResultCardListProps<Row extends BatchCardRow> {
  rows: Row[];
  loading: boolean;
  /** 加载失败信息；非空时保留已有列表并提示 */
  error?: string | null;
  emptyTitle: string;
  emptyDesc?: string;
  emptyChildren?: ReactNode;
  /** 删除一次生成（批次内全部任务） */
  onDeleteRow: (items: GalleryItem[]) => void;
  /** 重新生成：把这次生成的参数回填到页面表单 */
  onRegenerateRow?: (row: Row) => void;
  /** 单格名称（模块名 / 主图变体名） */
  labelOf: (item: GalleryItem) => string;
  /** 下载文件名前缀 */
  downloadNamePrefix: string;
}

const META_KEYS = ['resolution', 'ratio', 'platform', 'country', 'language'] as const;

export function BatchResultCardList<Row extends BatchCardRow>({
  rows,
  loading,
  error,
  emptyTitle,
  emptyDesc,
  emptyChildren,
  onDeleteRow,
  onRegenerateRow,
  labelOf,
  downloadNamePrefix,
}: BatchResultCardListProps<Row>) {
  return (
    <BatchResultList
      rows={rows}
      loading={loading}
      error={error}
      emptyTitle={emptyTitle}
      emptyDesc={emptyDesc}
      emptyChildren={emptyChildren}
      onDeleteRow={onDeleteRow}
      onRegenerateRow={onRegenerateRow}
      downloadNamePrefix={downloadNamePrefix}
      labelOf={labelOf}
      layout="card"
      cellLabelOf={(item) => labelOf(item)}
      renderRowTitle={(row) => (
        <div className="pd-result-card-title">
          <strong className="u-font-16" title={`商品：${row.productName || '未命名商品'}`}>
            商品：{row.productName || '未命名商品'}
          </strong>
          <time className="u-font-12" dateTime={row.createdAt}>{formatBatchDate(row.createdAt) || '时间未知'}</time>
        </div>
      )}
      renderRowMeta={(row) => {
        const status = resultStatusOf(row.cells);
        return (
          <>
            {META_KEYS.map((key) =>
              row.meta?.[key] ? (
                <span className="pd-result-meta-chip u-font-12" key={key}>
                  {row.meta[key]}
                </span>
              ) : null,
            )}
            <span className={`pd-result-status u-font-12 is-${status.tone}`}>{status.label}</span>
          </>
        );
      }}
      renderSourceCaption={() => null}
    />
  );
}
