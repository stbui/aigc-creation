import type { ReactNode } from 'react';
import { LayoutGrid } from 'lucide-react';

import { ToggleGroup, ToggleGroupItem } from './components';
import type { GroupBy } from './constants';

/** 分组依据切换：不分组 / 按项目 / 按能力 / 按日期 */
export interface LibraryGroupByToggleProps {
  value: GroupBy;
  onChange: (next: GroupBy) => void;
}

const GROUP_BY_OPTIONS: Array<{ value: GroupBy; label: string; icon?: ReactNode }> = [
  {
    value: 'none',
    label: '不分组',
    icon: <LayoutGrid className="size-3.5" />,
  },
  { value: 'project', label: '按项目' },
  { value: 'capability', label: '按能力' },
  { value: 'date', label: '按日期' },
];

export function LibraryGroupByToggle({ value, onChange }: LibraryGroupByToggleProps) {
  return (
    <ToggleGroup
      type="single"
      aria-label="素材分组方式"
      value={value}
      onValueChange={(next) => {
        if (!next) return;
        onChange(next as GroupBy);
      }}
      className="flex flex-wrap items-center gap-2.5"
    >
      {GROUP_BY_OPTIONS.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-border bg-card px-3 text-[13px] text-muted-foreground hover:border-brand hover:text-brand-hover data-[state=on]:border-solid data-[state=on]:border-brand data-[state=on]:bg-brand-bg data-[state=on]:text-brand-hover"
        >
          {option.icon}
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
