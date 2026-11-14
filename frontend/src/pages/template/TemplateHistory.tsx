import { memo, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { ImageLightbox, type LightboxItem } from './components';
import { assetThumbUrl, emptyResultLabel, templateIdOf, type TemplateEntry } from './utils';
import type { GalleryItem } from './hooks';
import { Spin } from '../../ui';

/**
 * 右栏「创作结果」页签的结果区。
 *
 * 由原来的底部「最近生成」历史条更名而来：模板灵感与创作结果拆成两个页签，
 * 结果区独占右栏，不再挤在模板网格下方。每次提交只产生一张写真，历史卡按单张陈列。
 */
export interface TemplateHistoryProps {
  items: GalleryItem[];
  templates: TemplateEntry[];
  loading: boolean;
  error?: string | null;
  onRefresh: () => void;
  onOpenAll: () => void;
}

function TemplateHistoryImpl({
  items,
  templates,
  loading,
  error,
  onRefresh,
  onOpenAll,
}: TemplateHistoryProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const nameOf = useMemo(() => {
    const byId = new Map(templates.map((template) => [template.id, template.name]));
    return (item: GalleryItem) => {
      const id = templateIdOf(item);
      return id ? byId.get(id) : undefined;
    };
  }, [templates]);

  const ready = useMemo(() => items.filter((item) => Boolean(item.url)), [items]);
  const lightbox: LightboxItem[] = useMemo(
    () =>
      ready.map((item) => ({
        id: item.id,
        url: item.url,
        alt: nameOf(item) ? `${nameOf(item)}生成写真` : '生成写真',
        width: item.width,
        height: item.height,
        createdAt: item.createdAt,
        meta: nameOf(item) ? [nameOf(item)!] : undefined,
      })),
    [ready, nameOf],
  );

  const openAt = (item: GalleryItem) => {
    const index = ready.findIndex((entry) => entry.id === item.id);
    if (index >= 0) setPreviewIndex(index);
  };

  return (
    <section className="tpl-history" aria-label="创作结果">
      <header className="tpl-history-head">
        <strong className="tpl-history-title">
          创作结果
          {items.length > 0 && <span className="tpl-history-count">{items.length} 张</span>}
        </strong>
        <div className="tpl-history-actions">
          <button
            type="button"
            className="tpl-history-link"
            onClick={onOpenAll}
            disabled={items.length === 0}
          >
            全部记录
          </button>
          <button type="button" className="tpl-history-refresh" disabled={loading} onClick={onRefresh}>
            <RefreshCw size={12} />
            {loading ? '刷新中' : '刷新'}
          </button>
        </div>
      </header>

      {error && <p className="tool-submit-notice tool-submit-notice-error">历史记录加载失败：{error}</p>}

      {loading && items.length === 0 ? (
        <div className="tpl-history-empty">
          <Spin />
        </div>
      ) : items.length === 0 ? (
        <div className="tpl-history-empty">还没有生成记录，提交任务后会显示在这里。</div>
      ) : (
        <div className="tpl-history-strip">
          {items.slice(0, 12).map((item) => (
            <button
              type="button"
              key={item.id}
              className={`tpl-history-card${item.url ? '' : ' is-pending'}`}
              title={nameOf(item) ? `查看${nameOf(item)}生成写真` : '查看生成写真'}
              onClick={() => openAt(item)}
            >
              {item.url ? (
                <img
                  src={assetThumbUrl(item.url, 320) ?? item.url}
                  alt={nameOf(item) ? `${nameOf(item)}生成写真` : '生成写真'}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span className="tpl-history-placeholder">{emptyResultLabel(item)}</span>
              )}
              <small>{nameOf(item) ?? '写真模板'}</small>
            </button>
          ))}
        </div>
      )}

      {previewIndex !== null && lightbox.length > 0 && (
        <ImageLightbox
          items={lightbox}
          index={Math.min(previewIndex, lightbox.length - 1)}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </section>
  );
}

export const TemplateHistory = memo(TemplateHistoryImpl);
