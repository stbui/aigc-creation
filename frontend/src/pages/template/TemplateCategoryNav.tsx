import type { TemplateCatalogCategory } from './api';
import { ALL_CATEGORY } from './constants';

interface TemplateCategoryNavProps {
  catalog: TemplateCatalogCategory[];
  categoryId: string;
  onSelect: (categoryId: string) => void;
}

/** 一级分类页签：全部模板 + 后端下发的分类。 */
export function TemplateCategoryNav({ catalog, categoryId, onSelect }: TemplateCategoryNavProps) {
  const itemClass = (active: boolean) =>
    `cursor-pointer border-0 border-b-2 bg-transparent px-0 pt-1.5 pb-2 text-sm transition-colors ${
      active
        ? 'border-b-brand font-semibold text-brand'
        : 'border-b-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-body)]'
    }`;

  return (
    <nav className="flex flex-wrap gap-x-[22px] pb-3" aria-label="模板分类">
      <button
        type="button"
        aria-pressed={categoryId === ALL_CATEGORY}
        className={itemClass(categoryId === ALL_CATEGORY)}
        onClick={() => onSelect(ALL_CATEGORY)}
      >
        全部模板
      </button>
      {catalog.map((category) => (
        <button
          key={category.id}
          type="button"
          aria-pressed={categoryId === category.id}
          className={itemClass(categoryId === category.id)}
          onClick={() => onSelect(category.id)}
        >
          {category.name}
        </button>
      ))}
    </nav>
  );
}
