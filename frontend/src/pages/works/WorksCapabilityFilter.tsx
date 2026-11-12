import { Check } from 'lucide-react';

import { WorksFilterMenu } from './WorksFilterMenu';
import type { WorksCapabilityGroup } from './useWorksFilters';

/** 业务类型筛选：按能力分组多选，选中后立即生效 */
export interface WorksCapabilityFilterProps {
  open: boolean;
  selected: string[];
  groups: WorksCapabilityGroup[];
  onToggleOpen: () => void;
  onClear: () => void;
  onToggle: (capabilityId: string) => void;
}

export function WorksCapabilityFilter({
  open,
  selected,
  groups,
  onToggleOpen,
  onClear,
  onToggle,
}: WorksCapabilityFilterProps) {
  const allSelected = selected.length === 0;
  return (
    <WorksFilterMenu
      label="业务类型"
      active={selected.length > 0}
      open={open}
      onToggle={onToggleOpen}
      title="业务类型"
      hint="可多选 · 选择后立即生效"
      popoverClassName="my-works-business-popover"
      badge={selected.length}
    >
      <button
        type="button"
        className={`my-works-business-all${allSelected ? ' selected' : ''}`}
        onClick={onClear}
      >
        <span className={`my-works-checkbox${allSelected ? ' on' : ''}`}>
          {allSelected && <Check size={11} />}
        </span>
        全部
      </button>
      {groups.map((group) => (
        <div key={group.name} className="my-works-option-group">
          <span className="my-works-option-group-title">{group.name}</span>
          <div className="my-works-option-chips">
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`my-works-option-chip${selected.includes(item.id) ? ' selected' : ''}`}
                onClick={() => onToggle(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </WorksFilterMenu>
  );
}
