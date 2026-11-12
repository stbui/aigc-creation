import { useMemo } from 'react';

import type { ShoppableCarouselTemplate } from '../../types/api';
import { ALL_CATEGORY } from './constants';
import type { GalleryItem } from './hooks';
import { filterTemplatesByCategory } from './utils';
import { ShoppableCarouselHistory } from './ShoppableCarouselHistory';
import { TemplateGrid } from './TemplateGrid';

interface ShoppableCarouselShowcaseProps {
  categories: Array<{ id: string; label: string }>;
  categoryId: string;
  onCategoryChange: (categoryId: string) => void;
  templates: ShoppableCarouselTemplate[];
  selectedTemplateId: string | null;
  onSelectTemplate: (template: ShoppableCarouselTemplate) => void;
  templatesError: string | null;
  templatesLoading: boolean;
  galleryItems: GalleryItem[];
  galleryLoading: boolean;
  galleryError: string | null;
  onRefreshGallery: () => void;
  onOpenAll: () => void;
}

/** 右栏：分类页签 + 模板网格（常驻）+ 底部历史条。 */
export function ShoppableCarouselShowcase({
  categories,
  categoryId,
  onCategoryChange,
  templates,
  selectedTemplateId,
  onSelectTemplate,
  templatesError,
  templatesLoading,
  galleryItems,
  galleryLoading,
  galleryError,
  onRefreshGallery,
  onOpenAll,
}: ShoppableCarouselShowcaseProps) {
  const visibleTemplates = useMemo(
    () => filterTemplatesByCategory(templates, categoryId),
    [templates, categoryId],
  );

  return (
    <>
      <nav className="sc-categories" aria-label="模板分类">
        <button
          type="button"
          aria-pressed={categoryId === ALL_CATEGORY}
          className={`sc-category${categoryId === ALL_CATEGORY ? ' is-active' : ''}`}
          onClick={() => onCategoryChange(ALL_CATEGORY)}
        >
          全部模板
        </button>
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            aria-pressed={categoryId === category.id}
            className={`sc-category${categoryId === category.id ? ' is-active' : ''}`}
            onClick={() => onCategoryChange(category.id)}
          >
            {category.label}
          </button>
        ))}
      </nav>

      <div className="sc-template-scroll">
        <TemplateGrid
          templates={visibleTemplates}
          selectedId={selectedTemplateId}
          onSelect={onSelectTemplate}
          error={templatesError}
          loading={templatesLoading}
        />
      </div>

      {/* 底部历史记录: 常驻, 不与模板区互斥 */}
      <ShoppableCarouselHistory
        items={galleryItems}
        loading={galleryLoading}
        error={galleryError}
        onRefresh={onRefreshGallery}
        onOpenAll={onOpenAll}
      />
    </>
  );
}
