import { useMemo } from 'react';

import type { TemplateCatalogCategory } from './api';
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

  const visibleTemplates = useMemo(
    () => filterCatalog(catalog, categoryId, groupId),
    [catalog, categoryId, groupId],
  );

  return (
    <>
      <TemplateCategoryNav catalog={catalog} categoryId={categoryId} onSelect={onCategoryChange} />

      {activeCategory && activeCategory.groups.length > 0 && (
        <TemplateGroupNav groups={activeCategory.groups} groupId={groupId} onChange={onGroupChange} />
      )}

      <div className="tpl-template-scroll">
        <TemplateGallery
          templates={visibleTemplates}
          selectedId={selectedTemplateId}
          onSelect={onSelectTemplate}
          error={templatesError}
          loading={templatesLoading}
          onRetry={onRetryTemplates}
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
    </>
  );
}
