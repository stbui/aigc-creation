import { ToggleGroup, ToggleGroupItem } from './components';
import type { AssetGroup } from './constants';
import { LibraryGroupOptionLabel } from './LibraryGroupOptionLabel';

/**
 * 分组筛选列表：全部素材 + 各分组的计数。
 *
 * 没有分组时自身不渲染（不分组 / 空库），调用方不必再判一次。
 */
export interface LibraryGroupFilterProps {
  groups: AssetGroup[];
  activeGroup: string | null;
  totalCount: number;
  onChange: (key: string | null) => void;
}

export function LibraryGroupFilter({
  groups,
  activeGroup,
  totalCount,
  onChange,
}: LibraryGroupFilterProps) {
  if (groups.length === 0) return null;
  return (
    <ToggleGroup
      type="single"
      aria-label="素材分组筛选"
      value={activeGroup ?? '__all__'}
      onValueChange={(next) => onChange(next && next !== '__all__' ? next : null)}
      className="mt-3 flex flex-wrap items-center gap-2.5"
    >
      <ToggleGroupItem
        value="__all__"
        className="group inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-transparent bg-muted px-3.5 text-[13px] text-foreground data-[state=on]:border-brand data-[state=on]:bg-brand-bg data-[state=on]:text-brand-hover"
      >
        <LibraryGroupOptionLabel label="全部素材" count={totalCount} />
      </ToggleGroupItem>
      {groups.map((group) => (
        <ToggleGroupItem
          key={group.key}
          value={group.key}
          title={group.label}
          className="group inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-transparent bg-muted px-3.5 text-[13px] text-foreground data-[state=on]:border-brand data-[state=on]:bg-brand-bg data-[state=on]:text-brand-hover"
        >
          <LibraryGroupOptionLabel label={group.label} count={group.count} />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
