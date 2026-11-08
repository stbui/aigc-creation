import { memo, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { ImageLightbox, type LightboxItem } from './components';
import { assetThumbUrl, batchSizeOf, buildRows, emptyBatchLabel, formatDate, formatShortDate, labelOf, type ResultRow } from './utils';
import type { GalleryItem } from './hooks';
import { Spin } from '../../ui';

/**
 * 右栏底部「最近生成」历史条。
 *
 * 页面结构对齐参考站的「左侧配置栏 + 右侧模板展示 + 底部历史记录」：
 * 模板展示**始终可见**，历史记录常驻右栏底部，不占用模板区。
 * （早先做成「模板 / 创作结果」互斥页签是错的——切到历史时模板区整块消失，
 * 而模板是模板生成模式的必需输入。）
 *
 * 交互:
 *   · 横条按批次列出最近生成，点某个批次开大图查看器；
 *   · 「全部记录」打开完整批次列表（含删除 / 下载）；
 *   · 「刷新」重拉列表。
 */
export interface ShoppableCarouselHistoryProps {
  items: GalleryItem[];
  loading: boolean;
  error?: string | null;
  onRefresh: () => void;
  onOpenAll: () => void;
}

/** 一个批次的展示卡数据 */
interface BatchCard {
  row: ResultRow;
  coverUrl?: string;
  readyCount: number;
  total: number;
  /** 无封面时的真实状态: 生成中 / 已取消 / 失败 */
  emptyLabel: string;
}

function batchCardsOf(items: GalleryItem[]): BatchCard[] {
  return buildRows(items).map((row) => {
    const ready = row.cells.filter((cell) => Boolean(cell.url));
    return {
      row,
      coverUrl: ready[0]?.url,
      readyCount: ready.length,
      total: batchSizeOf(row.cells),
      emptyLabel: emptyBatchLabel(row.cells),
    };
  });
}

/** 一个批次的可预览图（只收已出图的） */
function lightboxOf(card: BatchCard): LightboxItem[] {
  return card.row.cells
    .filter((cell) => Boolean(cell.url))
    .map((cell) => ({
      id: cell.id,
      url: cell.url,
      alt: labelOf(cell),
      width: cell.width,
      height: cell.height,
      createdAt: cell.createdAt,
      meta: [labelOf(cell)],
    }));
}

function ShoppableCarouselHistoryImpl({
  items,
  loading,
  error,
  onRefresh,
  onOpenAll,
}: ShoppableCarouselHistoryProps) {
  const cards = useMemo(() => batchCardsOf(items), [items]);
  const [preview, setPreview] = useState<{ items: LightboxItem[]; index: number } | null>(null);

  const openBatch = (card: BatchCard) => {
    const list = lightboxOf(card);
    // 整批失败 / 取消时没有可看的图，直接打开完整记录让用户看到失败状态
    if (list.length === 0) {
      onOpenAll();
      return;
    }
    setPreview({ items: list, index: 0 });
  };

  return (
    <section className="sc-history" aria-label="最近生成">
      <header className="sc-history-head">
        <strong className="sc-history-title">
          最近生成
          {cards.length > 0 && <span className="sc-history-count">{cards.length} 次</span>}
        </strong>
        <div className="sc-history-actions">
          <button type="button" className="sc-history-link" onClick={onOpenAll} disabled={cards.length === 0}>
            全部记录
          </button>
          <button type="button" className="sc-history-refresh" disabled={loading} onClick={onRefresh}>
            <RefreshCw size={12} />
            {loading ? '刷新中' : '刷新'}
          </button>
        </div>
      </header>

      {error && <p className="tool-submit-notice tool-submit-notice-error">历史记录加载失败：{error}</p>}

      {loading && cards.length === 0 ? (
        <div className="sc-history-empty">
          <Spin />
        </div>
      ) : cards.length === 0 ? (
        <div className="sc-history-empty">还没有生成记录，提交任务后会显示在这里。</div>
      ) : (
        <div className="sc-history-strip">
          {cards.map((card) => (
            <button
              type="button"
              key={card.row.key}
              className="sc-history-card"
              title={`${formatDate(card.row.createdAt)} · ${card.readyCount}/${card.total} 张`}
              onClick={() => openBatch(card)}
            >
              <span className="sc-history-thumb">
                {card.coverUrl ? (
                  <img src={assetThumbUrl(card.coverUrl, 320)} alt="" loading="lazy" />
                ) : (
                  <span className="sc-history-thumb-empty">{card.emptyLabel}</span>
                )}
                <span className="sc-history-badge">{card.readyCount}/{card.total}</span>
              </span>
              <span className="sc-history-meta">
                <small>{formatShortDate(card.row.createdAt)}</small>
                <small className="sc-history-template">{card.row.templateName || 'AI 智能生成'}</small>
              </span>
            </button>
          ))}
        </div>
      )}

      {preview && (
        <ImageLightbox
          items={preview.items}
          index={preview.index}
          onIndexChange={(index) => setPreview((prev) => (prev ? { ...prev, index } : prev))}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  );
}

export const ShoppableCarouselHistory = memo(ShoppableCarouselHistoryImpl);
