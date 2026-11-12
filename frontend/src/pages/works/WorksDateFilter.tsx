import { DATE_PRESET_SHORTCUTS, type DatePreset } from './constants';
import { WorksFilterMenu } from './WorksFilterMenu';

/**
 * 日期筛选：四个快捷档位 + 自定义区间。
 *
 * 改任一日期输入框都隐式切到 `custom`，否则过滤分支永远读不到自定义区间。
 */
export interface WorksDateFilterProps {
  open: boolean;
  preset: DatePreset;
  range: [string, string];
  onToggleOpen: () => void;
  onPresetChange: (preset: DatePreset) => void;
  onRangeChange: (range: [string, string]) => void;
}

export function WorksDateFilter({
  open,
  preset,
  range,
  onToggleOpen,
  onPresetChange,
  onRangeChange,
}: WorksDateFilterProps) {
  const changeRange = (next: [string, string]) => {
    onRangeChange(next);
    onPresetChange('custom');
  };

  return (
    <WorksFilterMenu
      label="日期"
      active={preset !== 'all'}
      open={open}
      onToggle={onToggleOpen}
      title="日期"
      hint="只精确到日期"
      popoverClassName="my-works-date-popover"
    >
      <div className="my-works-date-pills">
        {DATE_PRESET_SHORTCUTS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={preset === value ? 'selected' : ''}
            onClick={() => onPresetChange(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="my-works-custom-date">
        <span className="my-works-custom-date-label">自定义日期范围</span>
        <div className="my-works-date-fields">
          <input
            type="date"
            value={range[0]}
            onChange={(event) => changeRange([event.target.value, range[1]])}
          />
          <span>至</span>
          <input
            type="date"
            value={range[1]}
            onChange={(event) => changeRange([range[0], event.target.value])}
          />
        </div>
        <span className="my-works-custom-date-hint">包含开始日和结束日</span>
      </div>
    </WorksFilterMenu>
  );
}
