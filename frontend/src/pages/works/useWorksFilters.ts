import { useCallback, useEffect, useMemo, useState } from 'react';

import type { DatePreset, WorkStatus } from './constants';
import { capabilityName, startOfDay, taskModality, toggleInArray } from './utils';
import type { CapabilitiesData } from './utils';
import type { Task } from '../../types/api';

/**
 * 我的作品 · 工具栏筛选状态。
 *
 * 四个筛选器（业务类型 / 日期 / 状态 / 所属任务）的状态、浮层开合与派生列表
 * 都在这里；`page.tsx` 只负责取数、写操作与编排，`WorksToolbar` 只负责渲染。
 *
 * 筛选全部基于本地任务数据真实过滤（见 `matchingTasks`），不发额外请求。失败任务
 * 在取数时已排除，因此状态筛选只保留「成功 / 生成中」。
 */

/** 页签：按产出模态切分，图片 / 视频互不混排 */
export type WorksTab = 'image' | 'video';

/** 业务类型筛选的一个分组：能力分组名 + 组内能力 */
export interface WorksCapabilityGroup {
  name: string;
  items: CapabilitiesData['items'];
}

export interface UseWorksFiltersArgs {
  /** 已加载的任务（服务端分页后的本地全集，筛选只作用于它） */
  tasks: Task[];
  /** 能力清单：业务类型分组、所属任务检索都从它推导 */
  caps: CapabilitiesData | null;
  /** 当前页签 */
  tab: WorksTab;
}

export function useWorksFilters({ tasks, caps, tab }: UseWorksFiltersArgs) {
  const [capabilityOpen, setCapabilityOpen] = useState(false);
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([]);
  const [dateOpen, setDateOpen] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customRange, setCustomRange] = useState<[string, string]>(['', '']);
  const [statusOpen, setStatusOpen] = useState(false);
  const [selectedStatuses, setSelectedStatuses] = useState<WorkStatus[]>([]);
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskQuery, setTaskQuery] = useState('');
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);

  const closeAll = useCallback(() => {
    setCapabilityOpen(false);
    setDateOpen(false);
    setStatusOpen(false);
    setTaskOpen(false);
  }, []);

  /*
   * 点空白处 / 按 Esc 关闭筛选浮层。
   *
   * 桌面端移出工具栏可关，移动端手指点空白不会触发 mouseleave，浮层会一直盖在
   * 作品上；事件挂在 document 上并排除 toolbar 内部（浮层本身也在 toolbar 里），
   * 选择筛选时不会误关。
   */
  useEffect(() => {
    if (!capabilityOpen && !dateOpen && !statusOpen && !taskOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest('.my-works-toolbar')) return;
      closeAll();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [capabilityOpen, dateOpen, statusOpen, taskOpen, closeAll]);

  // ── 真实过滤 + 排序（全部基于本地任务数据，不做假筛选）──
  const matchingTasks = useMemo(() => {
    const now = new Date();
    const today = startOfDay(now);
    return tasks
      .filter((task) => {
        // 页签是第一道切分: 图片 / 视频互不混排
        if ((tab === 'video') !== (taskModality(task) === 'video')) return false;
        if (selectedCapabilities.length > 0 && !selectedCapabilities.includes(task.capability)) {
          return false;
        }
        if (selectedStatuses.length > 0) {
          // 失败 / 取消任务在取数时已排除，这里只剩成功与进行中两档。
          const bucket: WorkStatus = task.status === 'succeeded' ? 'succeeded' : 'running';
          if (!selectedStatuses.includes(bucket)) return false;
        }
        if (selectedTaskIds.length > 0 && !selectedTaskIds.includes(task.id)) return false;
        const createdAt = task.createdAt ? new Date(task.createdAt).getTime() : 0;
        if (datePreset === 'today' && createdAt < today) return false;
        if (datePreset === 'yesterday' && (createdAt < today - 86400000 || createdAt >= today)) {
          return false;
        }
        if (datePreset === '7d' && createdAt < today - 6 * 86400000) return false;
        if (datePreset === 'custom' && customRange[0] && customRange[1]) {
          const from = startOfDay(new Date(customRange[0]));
          const to = startOfDay(new Date(customRange[1])) + 86400000;
          if (createdAt < from || createdAt >= to) return false;
        }
        return true;
      })
      .sort(
        (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
      );
  }, [
    tasks,
    tab,
    selectedCapabilities,
    selectedStatuses,
    selectedTaskIds,
    datePreset,
    customRange,
  ]);

  const activeFilterCount =
    selectedCapabilities.length +
    selectedStatuses.length +
    selectedTaskIds.length +
    (datePreset === 'all' ? 0 : 1);

  /** 「清除筛选」：只清筛选，不动页签与勾选（勾选由页面随筛选变化一并清空） */
  const clearAll = useCallback(() => {
    setSelectedCapabilities([]);
    setSelectedStatuses([]);
    setSelectedTaskIds([]);
    setDatePreset('all');
    setCustomRange(['', '']);
  }, []);

  const toggleCapability = useCallback((id: string) => {
    setSelectedCapabilities((prev) => toggleInArray(prev, id));
  }, []);
  const toggleStatus = useCallback((status: WorkStatus) => {
    setSelectedStatuses((prev) => toggleInArray(prev, status));
  }, []);
  const toggleTask = useCallback((id: string) => {
    setSelectedTaskIds((prev) => toggleInArray(prev, id));
  }, []);

  /*
   * 业务类型按**产出模态**收集，而不是写死 group id。
   *
   * 之前图片页写死 ecommerce_gen/ai_retouch，导致 group 为 ai_video、但
   * modality=image 的 free_create 在图片页没有筛选项；视频页又会出现一个永远
   * 筛出空结果的组。现在从能力清单的 modality 推导分组，并对「图片页里的
   * ai_video 组」如实改名为「自由创作」，避免名实不符。
   */
  const capabilityGroups = useMemo<WorksCapabilityGroup[]>(() => {
    const items = caps?.items ?? [];
    const groups = caps?.groups ?? [];
    const modalItems = items.filter((item) => (item.modality ?? 'image') === tab);
    const groupIds = new Set(modalItems.map((item) => item.group));
    return groups
      .filter((group) => groupIds.has(group.id))
      .map((group) => ({
        name: tab === 'image' && group.id === 'ai_video' ? '自由创作' : group.name,
        items: modalItems.filter((item) => item.group === group.id),
      }))
      .filter((group) => group.items.length > 0);
  }, [caps, tab]);

  const matchedTasks = useMemo(() => {
    const query = taskQuery.trim();
    if (!query) return tasks.slice(0, 20);
    return tasks
      .filter((task) => capabilityName(task.capability).includes(query) || task.id.includes(query))
      .slice(0, 20);
  }, [tasks, taskQuery]);

  return {
    // 业务类型
    selectedCapabilities,
    setSelectedCapabilities,
    capabilityOpen,
    setCapabilityOpen,
    capabilityGroups,
    toggleCapability,
    // 日期
    datePreset,
    setDatePreset,
    dateOpen,
    setDateOpen,
    customRange,
    setCustomRange,
    // 状态
    selectedStatuses,
    setSelectedStatuses,
    statusOpen,
    setStatusOpen,
    toggleStatus,
    // 所属任务
    taskQuery,
    setTaskQuery,
    taskOpen,
    setTaskOpen,
    selectedTaskIds,
    setSelectedTaskIds,
    matchedTasks,
    toggleTask,
    // 派生与动作
    matchingTasks,
    activeFilterCount,
    closeAll,
    clearAll,
  };
}

/** 工具栏需要的筛选面（`WorksToolbar` 的 `filters` prop 即此类型） */
export type WorksFilters = ReturnType<typeof useWorksFilters>;
