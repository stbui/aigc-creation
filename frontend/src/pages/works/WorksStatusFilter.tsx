import { WORK_STATUS_OPTIONS, type WorkStatus } from './constants';
import { WorksFilterMenu } from './WorksFilterMenu';

/** 状态筛选：成功 / 生成中多选；失败任务不进入作品列表，故不提供该档 */
export interface WorksStatusFilterProps {
  open: boolean;
  selected: WorkStatus[];
  onToggleOpen: () => void;
  onToggle: (status: WorkStatus) => void;
}

export function WorksStatusFilter({
  open,
  selected,
  onToggleOpen,
  onToggle,
}: WorksStatusFilterProps) {
  return (
    <WorksFilterMenu
      label="状态"
      active={selected.length > 0}
      open={open}
      onToggle={onToggleOpen}
      title="状态"
      hint="按作品状态筛选"
      popoverClassName="my-works-status-popover"
    >
      <div className="my-works-status-pills">
        {WORK_STATUS_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={selected.includes(value) ? 'selected' : ''}
            onClick={() => onToggle(value)}
          >
            {label}
          </button>
        ))}
      </div>
    </WorksFilterMenu>
  );
}
