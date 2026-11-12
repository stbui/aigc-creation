import { FolderKanban } from 'lucide-react';

import { Button, Surface, SurfaceContent, SurfaceTitle } from './components';
import type { AssetGroup, GroupBy } from './constants';
import { LibraryGroupByToggle } from './LibraryGroupByToggle';
import { LibraryGroupFilter } from './LibraryGroupFilter';

/**
 * 分组面板：标题、分组方式与项目管理同排，分组结果另起一行。
 *
 * 「项目管理」是分组面板的入口；分组依据切换与分组筛选的选项与副作用
 * 分别落在 `LibraryGroupByToggle` / `LibraryGroupFilter` 里。
 */
export interface LibraryGroupPanelProps {
  groupBy: GroupBy;
  groups: AssetGroup[];
  activeGroup: string | null;
  totalCount: number;
  onGroupByChange: (next: GroupBy) => void;
  onSelectGroup: (key: string | null) => void;
  onOpenProjectManager: () => void;
}

export function LibraryGroupPanel({
  groupBy,
  groups,
  activeGroup,
  totalCount,
  onGroupByChange,
  onSelectGroup,
  onOpenProjectManager,
}: LibraryGroupPanelProps) {
  return (
    <Surface className="asset-library-groups-panel gap-0">
      <div className="asset-library-groups-bar">
        <SurfaceTitle className="asset-library-group-title">素材分组</SurfaceTitle>
        <LibraryGroupByToggle value={groupBy} onChange={onGroupByChange} />
        <Button
          type="text"
          size="small"
          icon={<FolderKanban className="size-3.5" />}
          className="ml-auto shrink-0"
          onClick={onOpenProjectManager}
        >
          项目管理
        </Button>
      </div>
      <SurfaceContent className="px-0">
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
