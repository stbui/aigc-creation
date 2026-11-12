import type { TemplateCatalogCategory } from './api';
import { ALL_CATEGORY } from './constants';

interface TemplateCategoryNavProps {
  catalog: TemplateCatalogCategory[];
  categoryId: string;
  onSelect: (categoryId: string) => void;
}

/** 一级分类页签：全部模板 + 后端下发的分类。 */
export function TemplateCategoryNav({ catalog, categoryId, onSelect }: TemplateCategoryNavProps) {
  return (
    <nav className="tpl-categories" aria-label="模板分类">
      <button
        type="button"
        aria-pressed={categoryId === ALL_CATEGORY}
        className={`tpl-category${categoryId === ALL_CATEGORY ? ' is-active' : ''}`}
        onClick={() => onSelect(ALL_CATEGORY)}
      >
        全部模板
      </button>
      {catalog.map((category) => (
        <button
          key={category.id}
          type="button"
          aria-pressed={categoryId === category.id}
          className={`tpl-category${categoryId === category.id ? ' is-active' : ''}`}
          onClick={() => onSelect(category.id)}
        >
          {category.name}
        </button>
      ))}
    </nav>
  );
}
