import { FolderKanban } from 'lucide-react';

import { Button, Card, CardContent, CardTitle } from './components';
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
    <Card className="mb-[18px] gap-0 rounded-xl border border-border bg-card px-5 py-[18px] shadow-[0_8px_24px_rgba(40,37,84,0.03)]">
      <div className="flex flex-wrap items-center gap-2.5">
        <CardTitle className="flex-none text-sm leading-5 font-semibold whitespace-nowrap text-foreground">
          素材分组
        </CardTitle>
        <LibraryGroupByToggle value={groupBy} onChange={onGroupByChange} />
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto shrink-0"
          onClick={onOpenProjectManager}
        >
          {<FolderKanban className="size-3.5" />}
          项目管理
        </Button>
      </div>
      <CardContent className="px-0">
        <LibraryGroupFilter
          groups={groups}
          activeGroup={activeGroup}
          totalCount={totalCount}
          onChange={onSelectGroup}
        />
      </CardContent>
    </Card>
  );
}
