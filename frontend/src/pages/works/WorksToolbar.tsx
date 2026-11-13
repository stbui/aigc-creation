import { Download } from 'lucide-react';

import type { WorksFilters } from './useWorksFilters';
import { WorksCapabilityFilter } from './WorksCapabilityFilter';
import { WorksDateFilter } from './WorksDateFilter';
import { WorksStatusFilter } from './WorksStatusFilter';
import { WorksTaskFilter } from './WorksTaskFilter';

/**
 * 我的作品 · 工具栏。
 *
 * 只做组合：四个筛选浮层（业务类型 / 日期 / 状态 / 所属任务）+「清除筛选」+
 * 「下载所选」。筛选状态由 `useWorksFilters` 持有，每个筛选器只接收自己那一
 * 片状态与语义化动作，不再把 20 多个字段摊进一个组件。
 *
 * 浮层关闭依赖两处：`onMouseLeave`（桌面端移出工具栏）与 document 上的
 * pointerdown / Escape（移动端没有 mouseleave），后者在 `useWorksFilters` 里。
 */
export interface WorksToolbarProps {
  /** 筛选状态全集（`useWorksFilters` 的返回值） */
  filters: WorksFilters;
  /** 已勾选作品数（下载按钮上的计数） */
  selectedCount: number;
  /** 已勾选且已出图的数量：为 0 时下载按钮禁用 */
  downloadableCount: number;
  onDownloadSelected: () => void;
}

export function WorksToolbar({
  filters,
  selectedCount,
  downloadableCount,
  onDownloadSelected,
}: WorksToolbarProps) {
  const {
    selectedCapabilities,
    setSelectedCapabilities,
    capabilityOpen,
    setCapabilityOpen,
    capabilityGroups,
    datePreset,
    setDatePreset,
    dateOpen,
    setDateOpen,
    customRange,
    setCustomRange,
    selectedStatuses,
    statusOpen,
    setStatusOpen,
    taskQuery,
    setTaskQuery,
    taskOpen,
    setTaskOpen,
    selectedTaskIds,
    setSelectedTaskIds,
    matchedTasks,
    activeFilterCount,
    closeAll,
    clearAll,
    toggleCapability,
    toggleStatus,
    toggleTask,
  } = filters;

  /** 打开某个浮层前先关掉其它三个；再次点击当前项则收起。 */
  const toggleMenu = (open: boolean, setOpen: (open: boolean) => void) => () => {
    closeAll();
    setOpen(!open);
  };

  return (
    <div className="my-works-toolbar" onMouseLeave={closeAll}>
      <WorksCapabilityFilter
        open={capabilityOpen}
        selected={selectedCapabilities}
        groups={capabilityGroups}
        onToggleOpen={toggleMenu(capabilityOpen, setCapabilityOpen)}
        onClear={() => setSelectedCapabilities([])}
        onToggle={toggleCapability}
      />

      <WorksDateFilter
        open={dateOpen}
        preset={datePreset}
        range={customRange}
        onToggleOpen={toggleMenu(dateOpen, setDateOpen)}
        onPresetChange={setDatePreset}
        onRangeChange={setCustomRange}
      />

      <WorksStatusFilter
        open={statusOpen}
        selected={selectedStatuses}
        onToggleOpen={toggleMenu(statusOpen, setStatusOpen)}
        onToggle={toggleStatus}
      />

      <WorksTaskFilter
        open={taskOpen}
        query={taskQuery}
        selected={selectedTaskIds}
        matched={matchedTasks}
        onToggleOpen={toggleMenu(taskOpen, setTaskOpen)}
        onQueryChange={setTaskQuery}
        onClear={() => setSelectedTaskIds([])}
        onToggle={toggleTask}
      />

      {/* 清除筛选紧跟筛选器 (次要动作), 主操作「下载所选」守在工具栏右端 */}
      {activeFilterCount > 0 && (
        <button type="button" className="my-works-filter-clear" onClick={clearAll}>
          清除筛选
        </button>
      )}

      <button
        type="button"
        className="my-works-download"
        disabled={downloadableCount === 0}
        title={downloadableCount === 0 ? '请先勾选已生成成功的作品' : undefined}
        onClick={onDownloadSelected}
      >
        <Download size={14} />
        下载所选{selectedCount > 0 ? ` (${selectedCount})` : ''}
      </button>
    </div>
  );
}
