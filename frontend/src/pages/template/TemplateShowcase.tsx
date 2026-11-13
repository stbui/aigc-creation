import { useEffect, useMemo, useRef } from 'react';

import type { TemplateCatalogCategory } from './api';
import { ALL_CATEGORY, ALL_GROUP } from './constants';
import type { GalleryItem } from './hooks';
import { filterCatalog, type TemplateEntry } from './utils';
import { TemplateCategoryNav } from './TemplateCategoryNav';
import { TemplateGallery } from './TemplateGallery';
import { TemplateGroupNav } from './TemplateGroupNav';
import { TemplateHistory } from './TemplateHistory';

interface TemplateShowcaseProps {
  catalog: TemplateCatalogCategory[];
  categoryId: string;
  groupId: string;
  onCategoryChange: (categoryId: string) => void;
  onGroupChange: (groupId: string) => void;
  /** 展平后的全量模板：历史卡回显模板名用 */
  allTemplates: TemplateEntry[];
  selectedTemplateId: string | null;
  onSelectTemplate: (template: TemplateEntry) => void;
  templatesLoading: boolean;
  templatesError: string | null;
  onRetryTemplates: () => void;
  galleryItems: GalleryItem[];
  galleryLoading: boolean;
  galleryError: string | null;
  onRefreshGallery: () => void;
  onOpenAll: () => void;
}

/** 右栏：一级 / 二级分类导航 + 模板网格（常驻）+ 底部历史条。 */
export function TemplateShowcase({
  catalog,
  categoryId,
  groupId,
  onCategoryChange,
  onGroupChange,
  allTemplates,
  selectedTemplateId,
  onSelectTemplate,
  templatesLoading,
  templatesError,
  onRetryTemplates,
  galleryItems,
  galleryLoading,
  galleryError,
  onRefreshGallery,
  onOpenAll,
}: TemplateShowcaseProps) {
  const activeCategory = useMemo(
    () => catalog.find((category) => category.id === categoryId) ?? null,
    [catalog, categoryId],
  );

  /** 切换分类 / 分组后回到顶部，避免停在上一组的滚动位置 */
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [categoryId, groupId]);

  const visibleTemplates = useMemo(
    () => filterCatalog(catalog, categoryId, groupId),
    [catalog, categoryId, groupId],
  );

  /** 分类 / 分组筛选导致空网格时，给一个回到全量的出口 */
  const filtered = categoryId !== ALL_CATEGORY || groupId !== ALL_GROUP;
  const showAll = filtered
    ? () => {
        onCategoryChange(ALL_CATEGORY);
        onGroupChange(ALL_GROUP);
      }
    : undefined;

  return (
    <section className="tpl-showcase" aria-label="写真模板">
      <TemplateCategoryNav catalog={catalog} categoryId={categoryId} onSelect={onCategoryChange} />

      {activeCategory && activeCategory.groups.length > 0 && (
        <TemplateGroupNav groups={activeCategory.groups} groupId={groupId} onChange={onGroupChange} />
      )}

      <div className="tpl-template-scroll" ref={scrollRef}>
        <TemplateGallery
          /* 换分类 / 分组时重挂载：分页条数、大图状态立即归零，不残留上一组 */
          key={`${categoryId}|${groupId}`}
          templates={visibleTemplates}
          selectedId={selectedTemplateId}
          onSelect={onSelectTemplate}
          error={templatesError}
          loading={templatesLoading}
          onRetry={onRetryTemplates}
          onShowAll={showAll}
        />
      </div>

      <TemplateHistory
        items={galleryItems}
        templates={allTemplates}
        loading={galleryLoading}
        error={galleryError}
        onRefresh={onRefreshGallery}
        onOpenAll={onOpenAll}
      />
    </section>
  );
}
