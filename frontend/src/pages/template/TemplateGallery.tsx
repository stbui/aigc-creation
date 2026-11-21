import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Eye, ImageOff, RotateCw, TriangleAlert } from 'lucide-react';

import { ImageLightbox, type LightboxItem } from './components';
import { SHIMMER_BG } from './constants';
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

/** 网格：宽屏 220px 起、窄档 180px、≤900 降 140px 保三列密度 */
const GRID =
  'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 max-[1240px]:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] max-[900px]:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] max-[900px]:gap-3';

/** 卡片骨架；选中态另加描边与外环 */
const CARD =
  'group flex flex-col rounded-xl border border-border bg-card px-[7px] pt-[7px] pb-2.5 transition-[border-color,box-shadow] hover:border-[var(--border-hover)] hover:shadow-card';

const CARD_SELECTED = 'border-brand shadow-[0_0_0_1px_var(--brand),0_8px_24px_rgba(85,70,216,0.12)]';

/** 封面左上角「看大图」：hover / 聚焦浮现，触屏常驻 */
const PREVIEW_BTN =
  'absolute top-2 left-2 flex size-7 cursor-zoom-in items-center justify-center rounded-md border-0 bg-white/90 text-foreground shadow-[0_1px_4px_rgba(15,23,42,0.12)] transition-[opacity,color] hover:text-brand focus-visible:opacity-100 [@media(hover:none)]:opacity-100';

/** 封面上浮的选用提示 */
const HOVER_LABEL =
  'pointer-events-none absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 translate-y-1.5 items-center rounded-full bg-[rgba(23,26,43,0.72)] px-3.5 py-1.5 text-[13px] font-semibold whitespace-nowrap text-primary-foreground opacity-0 transition-[opacity,transform] group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100';

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
      className={
        loaded
          ? 'block size-full object-cover transition-[opacity,transform] duration-300 group-hover:scale-[1.03]'
          : `block size-full object-cover opacity-0 transition-[opacity,transform] duration-300 group-hover:scale-[1.03] ${SHIMMER_BG}`
      }
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
    <div className={GRID} aria-busy="true" aria-label="模板加载中">
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <div className={`${CARD} pointer-events-none`} key={index} aria-hidden="true">
          <div className={`aspect-[3/4] rounded-md ${SHIMMER_BG}`} />
          <div className="grid gap-0.5 px-[3px] pt-[9px]">
            <div className={`h-3 w-[62%] rounded-md ${SHIMMER_BG}`} />
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
      <div
        className="flex min-h-[320px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center max-[900px]:min-h-[240px]"
        role="alert"
      >
        <span className="mb-0.5 flex size-11 items-center justify-center rounded-full bg-danger-soft text-danger-text">
          <TriangleAlert size={22} />
        </span>
        <strong className="text-[15px] text-foreground">模板加载失败</strong>
        <p className="m-0 max-w-[360px] text-[13px] leading-5 text-[color:var(--text-desc)]">
          {error}
        </p>
        {onRetry && (
          <button
            type="button"
            className="mt-1.5 inline-flex cursor-pointer items-center gap-1.5 rounded-md border-0 bg-brand px-4 py-[7px] text-[13px] font-semibold text-primary-foreground hover:bg-brand-hover"
            onClick={onRetry}
          >
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
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center max-[900px]:min-h-[240px]">
        <span className="mb-0.5 flex size-11 items-center justify-center rounded-full bg-brand-bg text-brand">
          <ImageOff size={22} />
        </span>
        <strong className="text-[15px] text-foreground">该分类下暂无模板</strong>
        <p className="m-0 max-w-[360px] text-[13px] leading-5 text-[color:var(--text-desc)]">
          运营正在补充新模板，可以先去其他分类看看。
        </p>
        {onShowAll && (
          <button
            type="button"
            className="mt-1.5 inline-flex cursor-pointer items-center gap-1.5 rounded-md border-0 bg-brand px-4 py-[7px] text-[13px] font-semibold text-primary-foreground hover:bg-brand-hover"
            onClick={onShowAll}
          >
            查看全部模板
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className={GRID}>
        {visibleTemplates.map((template, index) => {
          const selected = template.id === selectedId;
          return (
            <article
              key={template.id}
              className={`${CARD}${selected ? ` ${CARD_SELECTED}` : ''}`}
              data-testid={`tpl-template-${template.id}`}
            >
              <div className="relative aspect-[3/4] overflow-hidden rounded-md bg-[var(--surface-soft)]">
                <button
                  type="button"
                  className="relative block size-full cursor-pointer border-0 bg-transparent p-0"
                  onClick={() => onSelect(template)}
                  aria-label={`选用模板${template.name}`}
                  aria-pressed={selected}
                >
                  <TemplateCover
                    src={template.thumbFile}
                    alt={`${template.name} 模板预览`}
                  />
                  <span
                    className={`${HOVER_LABEL} ${
                      selected ? 'translate-y-0 bg-brand opacity-100' : ''
                    }`}
                    aria-hidden="true"
                  >
                    {selected ? '已选用' : '使用此模板'}
                  </span>
                </button>
                <button
                  type="button"
                  className={`${PREVIEW_BTN} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                  aria-label={`查看${template.name}大图`}
                  title="看大图"
                  onClick={() => setPreviewIndex(index)}
                >
                  <Eye size={14} />
                </button>
                {selected && (
                  <span
                    className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-brand text-primary-foreground shadow-[0_2px_6px_rgba(85,70,216,0.35)]"
                    aria-hidden="true"
                  >
                    <Check size={14} strokeWidth={3} />
                  </span>
                )}
              </div>

              <div className="grid gap-0.5 px-[3px] pt-[9px]">
                <strong
                  className="truncate text-sm leading-5 font-semibold text-foreground"
                  title={template.name}
                >
                  {template.name}
                </strong>
                <span className="truncate text-xs leading-4 text-[color:var(--text-desc)]">
                  {template.categoryName} · {template.groupName}
                </span>
              </div>
            </article>
          );
        })}
      </div>

      {hasMore && (
        <div
          className="flex items-center justify-center gap-2 pt-5 pb-1 text-xs text-[color:var(--text-desc)]"
          ref={sentinelRef}
          role="status"
          aria-live="polite"
        >
          <span
            className="size-3.5 animate-spin rounded-full border-2 border-border border-t-brand motion-reduce:[animation-duration:2.4s]"
            aria-hidden="true"
          />
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
