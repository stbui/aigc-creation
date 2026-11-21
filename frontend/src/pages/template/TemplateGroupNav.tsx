import type { TemplateCatalogGroup } from './api';
import { ALL_GROUP } from './constants';

interface TemplateGroupNavProps {
  groups: TemplateCatalogGroup[];
  groupId: string;
  onChange: (groupId: string) => void;
}

/** 二级分组页签：全部分组 + 当前一级分类下的分组（带模板数）。 */
export function TemplateGroupNav({ groups, groupId, onChange }: TemplateGroupNavProps) {
  const itemClass = (active: boolean) =>
    `inline-flex cursor-pointer items-center gap-[5px] rounded-full border px-2.5 py-[3px] text-xs transition-colors ${
      active
        ? 'border-[var(--border-brand)] bg-brand-bg font-semibold text-brand'
        : 'border-border bg-card text-[color:var(--text-body)] hover:border-[var(--border-brand)] hover:text-brand'
    }`;

  return (
    <nav className="flex flex-wrap gap-2 pb-3" aria-label="模板二级分类">
      <button
        type="button"
        aria-pressed={groupId === ALL_GROUP}
        className={itemClass(groupId === ALL_GROUP)}
        onClick={() => onChange(ALL_GROUP)}
      >
        全部分组
      </button>
      {groups.map((group) => (
        <button
          key={group.id}
          type="button"
          aria-pressed={groupId === group.id}
          className={itemClass(groupId === group.id)}
          onClick={() => onChange(group.id)}
        >
          {group.name}
          <span className="text-xs font-normal text-[color:var(--text-desc)]">
            {group.items.length}
          </span>
        </button>
      ))}
    </nav>
  );
}
