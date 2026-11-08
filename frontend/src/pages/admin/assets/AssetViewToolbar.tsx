import { Grid3x3, List } from 'lucide-react';
import { ActionButton, CheckboxField, ExportCsvButton, SegmentedGroup } from '~/admin-ui/primitives';

interface AssetViewToolbarProps {
  view: 'grid' | 'table';
  itemCount: number;
  selectedCount: number;
  selectable: boolean;
  canHide: boolean;
  canDelete: boolean;
  canExport: boolean;
  busy: boolean;
  allPageSelected: boolean;
  somePageSelected: boolean;
  onBatchHide: () => void;
  onBatchShow: () => void;
  onBatchDelete: () => void;
  onClearSelection: () => void;
  onToggleSelectPage: (checked: boolean) => void;
  onViewChange: (view: 'grid' | 'table') => void;
  onExport: () => void;
}

/** 素材列表工具条：批量动作、本页全选、视图切换与导出。 */
export function AssetViewToolbar({
  view,
  itemCount,
  selectedCount,
  selectable,
  canHide,
  canDelete,
  canExport,
  busy,
  allPageSelected,
  somePageSelected,
  onBatchHide,
  onBatchShow,
  onBatchDelete,
  onClearSelection,
  onToggleSelectPage,
  onViewChange,
  onExport,
}: AssetViewToolbarProps) {
  return (
    <div className="flex items-center gap-2">
      {selectedCount > 0 && (
        <div role="status" data-testid="admin-bulk-bar" className="flex items-center gap-2 border-r border-border pr-2">
          <span className="text-xs font-medium text-foreground">已选 {selectedCount} 张</span>
          {canHide && (
            <>
              <ActionButton variant="secondary" size="sm" onClick={onBatchHide} disabled={busy}>
                批量下架
              </ActionButton>
              <ActionButton variant="secondary" size="sm" onClick={onBatchShow} disabled={busy}>
                批量恢复
              </ActionButton>
            </>
          )}
          {canDelete && (
            <ActionButton variant="destructive" size="sm" onClick={onBatchDelete} disabled={busy}>
              批量删除
            </ActionButton>
          )}
          <ActionButton variant="ghost" size="sm" onClick={onClearSelection}>
            清空选择
          </ActionButton>
        </div>
      )}
      {view === 'grid' && itemCount > 0 && selectable && (
        <CheckboxField
          size="sm"
          checked={allPageSelected}
          indeterminate={somePageSelected}
          label={allPageSelected ? '取消全选' : '全选本页'}
          onChange={onToggleSelectPage}
        />
      )}
      <SegmentedGroup
        ariaLabel="切换视图"
        value={view}
        onChange={(next) => onViewChange(next as 'grid' | 'table')}
        options={[
          {
            value: 'grid',
            label: (
              <span className="inline-flex items-center gap-1" title="缩略图网格">
                <Grid3x3 className="size-3.5" aria-hidden />
                网格
              </span>
            ),
          },
          {
            value: 'table',
            label: (
              <span className="inline-flex items-center gap-1" title="表格视图">
                <List className="size-3.5" aria-hidden />
                表格
              </span>
            ),
          },
        ]}
      />
      {canExport && <ExportCsvButton size="default" onExport={onExport} />}
    </div>
  );
}
