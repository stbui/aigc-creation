import { useMemo } from 'react';

import type { ShoppableCarouselTemplate } from '../../types/api';
import { ALL_CATEGORY } from './constants';
import { OutputTabsPane, type OutputTab } from './components';
import type { GalleryItem } from './hooks';
import { buildRows, filterTemplatesByCategory } from './utils';
import { ShoppableCarouselResultList } from './ShoppableCarouselResultList';
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
  /** 右栏页签：demo = 创作灵感，results = 创作结果 */
  activeTab: OutputTab;
  onTabChange: (tab: OutputTab) => void;
  galleryItems: GalleryItem[];
  galleryLoading: boolean;
  galleryError: string | null;
  /** 删除一次生成（批次内全部任务） */
  onDeleteRow: (items: GalleryItem[]) => void;
  emptyDesc?: string;
}

/**
 * 右栏：顶部「创作灵感 / 创作结果」两个页签（与写真模板页同构）。
 *
 * 灵感页放分类导航 + 模板网格；结果页放完整批次列表（原「全部记录」抽屉内容，
 * 含删除 / 下载 / 大图）。外壳复用商品主图 / 商品详情 / 写真模板的
 * `OutputTabsPane`，胶囊页签样式不另写一套。
 *
 * 原右栏底部常驻的「最近生成」历史条已删除，不再与模板区并存 ——
 * 与 `docs/design/web/shoppable-carousel-design.md` §14.1 记录的「模板区常驻」决策相反，
 * 属产品决策变更。
 */
export function ShoppableCarouselShowcase({
  categories,
  categoryId,
  onCategoryChange,
  templates,
  selectedTemplateId,
  onSelectTemplate,
  templatesError,
  templatesLoading,
  activeTab,
  onTabChange,
  galleryItems,
  galleryLoading,
  galleryError,
  onDeleteRow,
  emptyDesc,
}: ShoppableCarouselShowcaseProps) {
  const visibleTemplates = useMemo(
    () => filterTemplatesByCategory(templates, categoryId),
    [templates, categoryId],
  );

  /** 页签角标按「次数」计：一次提交可能拆成多张图，与结果区行数一致 */
  const generationCount = useMemo(() => buildRows(galleryItems).length, [galleryItems]);

  return (
    <OutputTabsPane
      value={activeTab}
      onChange={onTabChange}
      generationCount={generationCount}
      demoLabel="创作灵感"
      ariaLabel="右栏面板"
      demo={
        <section className="sc-showcase" aria-label="带货图文模板">
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
        </section>
      }
      results={
        <ShoppableCarouselResultList
          items={galleryItems}
          loading={galleryLoading}
          error={galleryError}
          emptyTitle="还没有生成记录"
          emptyDesc={emptyDesc}
          onDeleteRow={onDeleteRow}
        />
      }
    />
  );
}
