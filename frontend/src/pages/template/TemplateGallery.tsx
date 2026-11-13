import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Eye, ImageOff, RotateCw, TriangleAlert } from 'lucide-react';

import { ImageLightbox, type LightboxItem } from './components';
import type { TemplateEntry } from './utils';

/**
 * 写真模板网格（右栏主内容）。
 *
 * 卡片只展示预览图、模板名与所属分组：模板提示词不下发到 C 端，标签与大图
 * 入口等附加信息都不展示。选中反馈由品牌紫描边、右上角对勾与常驻的「已选用」
 * 浮层三处共同表达；hover 时浮出「使用此模板」，点击整张封面即选用；
 * 左上角放大镜单独打开大图查看器，不影响选中状态。
 */

const SKELETON_COUNT = 8;

/**
 * 每屏渲染的模板数。
 *
 * 「全部模板」有 500+ 条，一次性建 500 个卡片节点会让首屏变慢、
 * 也让浏览器的懒加载阈值一次性把大量图片拉下来。滚动到底部再追加一页。
 */
const PAGE_SIZE = 24;

export interface TemplateGalleryProps {
  templates: TemplateEntry[];
  /** 当前选中的模板 id */
  selectedId: string | null;
  onSelect: (template: TemplateEntry) => void;
  /** 模板清单加载失败 */
  error?: string | null;
  loading?: boolean;
  /** 重新拉取模板清单（后端重启 / 网络抖动后无需整页刷新） */
  onRetry?: () => void;
  /** 当前分类为空时回到「全部模板」；全量也为空时不传 */
  onShowAll?: () => void;
}

/** 封面图：解码完成后再淡入，避免骨架与图片之间出现闪白 */
function TemplateCover({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  /* 缓存命中的图片可能在 onLoad 挂载前就已 complete，补一次判定 */
  useEffect(() => {
    if (ref.current?.complete) setLoaded(true);
  }, []);

  return (
    <img
      ref={ref}
      className={loaded ? 'is-loaded' : undefined}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(true)}
    />
  );
}

function LoadingGrid() {
  return (
    <div className="tpl-template-grid" aria-busy="true" aria-label="模板加载中">
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <div className="tpl-template-card is-skeleton" key={index} aria-hidden="true">
          <div className="tpl-skeleton-cover" />
          <div className="tpl-template-content">
            <div className="tpl-skeleton-line" />
          </div>
        </div>
      ))}
    </div>
  );
}

function TemplateGalleryImpl({
  templates,
  selectedId,
  onSelect,
  error,
  loading,
  onRetry,
  onShowAll,
}: TemplateGalleryProps) {
  /** 大图查看器：在当前筛选结果内翻页，索引为 null 时关闭 */
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const lightboxItems: LightboxItem[] = useMemo(
    () =>
      templates.map((template) => ({
        id: template.id,
        url: template.thumbFile,
        alt: `${template.name} 模板预览`,
        meta: [template.categoryName, template.groupName],
      })),
    [templates],
  );

  /** 当前已渲染的条数；切换分类 / 分组时回到第一页 */
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [templates]);

  const visibleTemplates = templates.slice(0, visibleCount);
  const hasMore = visibleCount < templates.length;

  /**
   * 滚动到底部前 480px 时追加一页。
   *
   * `root` 取实际滚动容器（`.tpl-template-scroll`）而不是视口：右栏是
   * 独立滚动区，用视口做 root 时哨兵在容器裁剪下永远不会「可见」。
   */
  useEffect(() => {
    if (!hasMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const scrollRoot = sentinel.closest('.tpl-template-scroll');
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleCount((count) => Math.min(count + PAGE_SIZE, templates.length));
      },
      {
        root: scrollRoot instanceof HTMLElement ? scrollRoot : null,
        rootMargin: '480px 0px',
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, visibleCount, templates.length]);

  if (error) {
    return (
      <div className="tpl-state-card" role="alert">
        <span className="tpl-state-icon is-error">
          <TriangleAlert size={22} />
        </span>
        <strong>模板加载失败</strong>
        <p>{error}</p>
        {onRetry && (
          <button type="button" className="tpl-state-action" onClick={onRetry}>
            <RotateCw size={14} />
            重新加载
          </button>
        )}
      </div>
    );
  }

  if (loading && templates.length === 0) {
    return <LoadingGrid />;
  }

  if (templates.length === 0) {
    return (
      <div className="tpl-state-card">
        <span className="tpl-state-icon">
          <ImageOff size={22} />
        </span>
        <strong>该分类下暂无模板</strong>
        <p>运营正在补充新模板，可以先去其他分类看看。</p>
        {onShowAll && (
          <button type="button" className="tpl-state-action" onClick={onShowAll}>
            查看全部模板
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="tpl-template-grid">
        {visibleTemplates.map((template, index) => {
          const selected = template.id === selectedId;
          return (
            <article
              key={template.id}
              className={`tpl-template-card${selected ? ' is-selected' : ''}`}
              data-testid={`tpl-template-${template.id}`}
            >
              <div className="tpl-template-cover">
                <button
                  type="button"
                  className="tpl-template-cover-btn"
                  onClick={() => onSelect(template)}
                  aria-label={`选用模板${template.name}`}
                  aria-pressed={selected}
                >
                  <TemplateCover
                    src={template.thumbFile}
                    alt={`${template.name} 模板预览`}
                  />
                  <span className="tpl-template-hover" aria-hidden="true">
                    {selected ? '已选用' : '使用此模板'}
                  </span>
                </button>
                <button
                  type="button"
                  className="tpl-template-preview"
                  aria-label={`查看${template.name}大图`}
                  title="看大图"
                  onClick={() => setPreviewIndex(index)}
                >
                  <Eye size={14} />
                </button>
                {selected && (
                  <span className="tpl-template-check" aria-hidden="true">
                    <Check size={14} strokeWidth={3} />
                  </span>
                )}
              </div>

              <div className="tpl-template-content">
                <strong className="tpl-template-title" title={template.name}>
                  {template.name}
                </strong>
                <span className="tpl-template-meta">
                  {template.categoryName} · {template.groupName}
                </span>
              </div>
            </article>
          );
        })}
      </div>

      {hasMore && (
        <div className="tpl-load-more" ref={sentinelRef} role="status" aria-live="polite">
          <span className="tpl-load-more-spinner" aria-hidden="true" />
          正在加载更多（已显示 {visibleCount} / {templates.length}）
        </div>
      )}

      {previewIndex !== null && lightboxItems.length > 0 && (
        <ImageLightbox
          items={lightboxItems}
          index={Math.min(previewIndex, lightboxItems.length - 1)}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          ariaLabel="模板大图预览"
        />
      )}
    </>
  );
}

/** memo: 分类切换才重建网格，左栏输入不影响 */
export const TemplateGallery = memo(TemplateGalleryImpl);
