import { LayoutGrid } from 'lucide-react';

import { ToggleGroup } from './components';
import type { GroupBy } from './constants';

/** 分组依据切换：不分组 / 按项目 / 按能力 / 按日期 */
export function LibraryGroupByToggle({
  value,
  onChange,
}: {
  value: GroupBy;
  onChange: (next: GroupBy) => void;
}) {
  return (
    <ToggleGroup
      aria-label="素材分组方式"
      value={value}
      itemClassName="asset-library-new-group"
      className="asset-library-group-list"
      options={[
        {
          value: 'none',
          label: '不分组',
          icon: <LayoutGrid className="size-3.5" />,
        },
        { value: 'project', label: '按项目' },
        { value: 'capability', label: '按能力' },
        { value: 'date', label: '按日期' },
      ]}
      onValueChange={(next) => {
        if (!next) return;
        onChange(next as GroupBy);
      }}
    />
  );
}
