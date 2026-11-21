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

/** 卡片缩略图与占位共用尺寸，缺图时不塌行 */
const THUMB =
  'flex h-16 w-[90px] items-center justify-center rounded-md border border-border object-cover';

/** 结果区内的文字动作（全部记录 / 刷新） */
const TEXT_ACTION =
  'inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-xs hover:text-brand-hover disabled:cursor-not-allowed disabled:text-[color:var(--text-desc)] disabled:hover:text-[color:var(--text-desc)]';

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
    <section
      className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-card px-5 py-3"
      aria-label="创作结果"
    >
      <header className="mb-2 flex items-center justify-between gap-3">
        <strong className="inline-flex items-center gap-2 text-[13px] font-semibold text-foreground">
          创作结果
          {items.length > 0 && (
            <span className="text-xs font-normal text-[color:var(--text-desc)]">
              {items.length} 张
            </span>
          )}
        </strong>
        <div className="inline-flex items-center gap-3">
          <button
            type="button"
            className={`${TEXT_ACTION} text-brand`}
            onClick={onOpenAll}
            disabled={items.length === 0}
          >
            全部记录
          </button>
          <button
            type="button"
            className={`${TEXT_ACTION} text-[color:var(--text-body)]`}
            disabled={loading}
            onClick={onRefresh}
          >
            <RefreshCw size={12} />
            {loading ? '刷新中' : '刷新'}
          </button>
        </div>
      </header>

      {error && <p className="tool-submit-notice tool-submit-notice-error">历史记录加载失败：{error}</p>}

      {loading && items.length === 0 ? (
        <div className="flex h-12 items-center justify-center text-xs text-[color:var(--text-desc)]">
          <Spin />
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-12 items-center justify-center text-xs text-[color:var(--text-desc)]">
          还没有生成记录，提交任务后会显示在这里。
        </div>
      ) : (
        <div className="flex flex-wrap gap-2.5 overflow-visible pb-0.5">
          {items.slice(0, 12).map((item) => (
            <button
              type="button"
              key={item.id}
              className="group flex w-[90px] shrink-0 cursor-pointer flex-col gap-1 border-0 bg-transparent p-0 text-left"
              title={nameOf(item) ? `查看${nameOf(item)}生成写真` : '查看生成写真'}
              onClick={() => openAt(item)}
            >
              {item.url ? (
                <img
                  className={`${THUMB} bg-[var(--surface-soft)] group-hover:border-brand`}
                  src={assetThumbUrl(item.url, 320) ?? item.url}
                  alt={nameOf(item) ? `${nameOf(item)}生成写真` : '生成写真'}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span
                  className={`${THUMB} bg-[var(--surface-soft)] text-xs text-[color:var(--text-desc)] group-hover:border-brand`}
                >
                  {emptyResultLabel(item)}
                </span>
              )}
              <small className="truncate text-xs text-[color:var(--text-muted)]">
                {nameOf(item) ?? '写真模板'}
              </small>
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
