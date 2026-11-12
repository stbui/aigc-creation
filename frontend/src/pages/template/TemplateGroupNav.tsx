import type { TemplateCatalogGroup } from './api';
import { ALL_GROUP } from './constants';

interface TemplateGroupNavProps {
  groups: TemplateCatalogGroup[];
  groupId: string;
  onChange: (groupId: string) => void;
}

/** 二级分组页签：全部分组 + 当前一级分类下的分组（带模板数）。 */
export function TemplateGroupNav({ groups, groupId, onChange }: TemplateGroupNavProps) {
  return (
    <nav className="tpl-subcategories" aria-label="模板二级分类">
      <button
        type="button"
        aria-pressed={groupId === ALL_GROUP}
        className={`tpl-subcategory${groupId === ALL_GROUP ? ' is-active' : ''}`}
        onClick={() => onChange(ALL_GROUP)}
      >
        全部分组
      </button>
      {groups.map((group) => (
        <button
          key={group.id}
          type="button"
          aria-pressed={groupId === group.id}
          className={`tpl-subcategory${groupId === group.id ? ' is-active' : ''}`}
          onClick={() => onChange(group.id)}
        >
          {group.name}
          <span className="tpl-subcategory-count">{group.items.length}</span>
        </button>
      ))}
    </nav>
  );
}
