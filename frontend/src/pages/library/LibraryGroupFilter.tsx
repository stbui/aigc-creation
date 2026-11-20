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
      className="asset-library-group-list"
    >
      <ToggleGroupItem value="__all__" className="asset-library-group-item">
        <LibraryGroupOptionLabel label="全部素材" count={totalCount} />
      </ToggleGroupItem>
      {groups.map((group) => (
        <ToggleGroupItem
          key={group.key}
          value={group.key}
          title={group.label}
          className="asset-library-group-item"
        >
          <LibraryGroupOptionLabel label={group.label} count={group.count} />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
