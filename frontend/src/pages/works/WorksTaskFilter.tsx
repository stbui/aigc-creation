import { Search } from 'lucide-react';

import { WorksFilterMenu } from './WorksFilterMenu';
import { capabilityName } from './utils';
import type { Task } from '../../types/api';

/** 所属任务筛选：支持任务 ID / 能力名称检索，可多选 */
export interface WorksTaskFilterProps {
  open: boolean;
  query: string;
  selected: string[];
  matched: Task[];
  onToggleOpen: () => void;
  onQueryChange: (query: string) => void;
  onClear: () => void;
  onToggle: (id: string) => void;
}

export function WorksTaskFilter({
  open,
  query,
  selected,
  matched,
  onToggleOpen,
  onQueryChange,
  onClear,
  onToggle,
}: WorksTaskFilterProps) {
  return (
    <WorksFilterMenu
      label="所属任务"
      active={selected.length > 0}
      open={open}
      onToggle={onToggleOpen}
      title="所属任务"
      hint="支持任务 ID 或能力名称搜索"
      popoverClassName="my-works-task-popover"
    >
      <label className="my-works-task-search">
        <Search size={13} />
        <input
          value={query}
          placeholder="搜索任务"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      <div className="my-works-task-list">
        <button
          type="button"
          className={selected.length === 0 ? 'selected' : ''}
          onClick={onClear}
        >
          全部任务
        </button>
        {matched.map((task) => (
          <button
            key={task.id}
            type="button"
            className={selected.includes(task.id) ? 'selected' : ''}
            onClick={() => onToggle(task.id)}
          >
            <span>{capabilityName(task.capability)}</span>
            <small>{task.id.slice(-8)}</small>
          </button>
        ))}
        {matched.length === 0 && <span className="my-works-task-empty">无匹配任务</span>}
      </div>
    </WorksFilterMenu>
  );
}
