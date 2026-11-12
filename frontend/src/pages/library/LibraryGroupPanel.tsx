import { FolderKanban } from 'lucide-react';

import { Button, Surface, SurfaceContent, SurfaceHeader, SurfaceTitle } from './components';
import type { AssetGroup, GroupBy } from './constants';
import { LibraryGroupByToggle } from './LibraryGroupByToggle';
import { LibraryGroupFilter } from './LibraryGroupFilter';

/**
 * 分组面板：只做组合，两个 ToggleGroup 各自独立。
 *
 * 「项目管理」是分组面板的入口；分组依据切换与分组筛选的选项与副作用
 * 分别落在 `LibraryGroupByToggle` / `LibraryGroupFilter` 里。
 */
export function LibraryGroupPanel({
  groupBy,
  groups,
  activeGroup,
  totalCount,
  onGroupByChange,
  onSelectGroup,
  onOpenProjectManager,
}: {
  groupBy: GroupBy;
  groups: AssetGroup[];
  activeGroup: string | null;
  totalCount: number;
  onGroupByChange: (next: GroupBy) => void;
  onSelectGroup: (key: string | null) => void;
  onOpenProjectManager: () => void;
}) {
  return (
    <Surface className="asset-library-groups-panel gap-0">
      <SurfaceHeader className="asset-library-group-head px-0">
        <SurfaceTitle className="asset-library-group-title">素材分组</SurfaceTitle>
        <Button
          type="text"
          size="small"
          icon={<FolderKanban className="size-3.5" />}
          className="ml-auto shrink-0"
          onClick={onOpenProjectManager}
        >
          项目管理
        </Button>
      </SurfaceHeader>
      <SurfaceContent className="px-0">
        <LibraryGroupByToggle value={groupBy} onChange={onGroupByChange} />
        <LibraryGroupFilter
          groups={groups}
          activeGroup={activeGroup}
          totalCount={totalCount}
          onChange={onSelectGroup}
        />
      </SurfaceContent>
    </Surface>
  );
}
