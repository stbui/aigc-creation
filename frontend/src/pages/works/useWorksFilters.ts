import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type { DatePreset } from './constants';
import { capabilityName, startOfDay, taskModality } from './utils';
import type { CapabilitiesData } from './utils';
import type { Task } from '../../types/api';

/**
 * 我的作品 · 工具栏筛选状态。
 *
 * 2026-11-04 从 `page.tsx` 抽出：工具栏的四个筛选器（业务类型 / 日期 / 状态 /
 * 所属任务）共 10 个 state + 3 个派生值 + 点击空白关闭，原先与取数、写操作搅在
 * 同一个 1095 行组件里。抽成 hook 后 `page.tsx` 只负责「取数 + 写操作 + 编排」，
 * `WorksToolbar` 只负责渲染浮层，两边共享同一份状态而不必互传 28 个 props。
 *
 * 筛选全部基于本地任务数据真实过滤（见 `filtered`），不发额外请求。失败任务
 * 在取数时已排除，因此状态筛选只保留「成功 / 生成中」。
 */

/** 页签：按产出模态切分，图片 / 视频互不混排 */
export type WorksTab = 'image' | 'video';

/** 业务类型筛选的一个分组：能力分组名 + 组内能力 */
export interface WorksBizGroup {
  name: string;
  items: CapabilitiesData['items'];
}

/** 切换数组型筛选里的某一项（已选则移除，未选则追加） */
export type ToggleIn = (
  arr: string[],
  v: string,
  set: Dispatch<SetStateAction<string[]>>,
) => void;

export interface UseWorksFiltersArgs {
  /** 已加载的任务（服务端分页后的本地全集，筛选只作用于它） */
  tasks: Task[];
  /** 能力清单：业务类型分组、所属任务检索都从它推导 */
  caps: CapabilitiesData | null;
  /** 当前页签 */
  tab: WorksTab;
}

export function useWorksFilters({ tasks, caps, tab }: UseWorksFiltersArgs) {
  // 四个筛选器（与参考站一致的多选/单选语义）+ 各自浮层的开合
  const [bizOpen, setBizOpen] = useState(false);
  const [biz, setBiz] = useState<string[]>([]);
  const [dateOpen, setDateOpen] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customRange, setCustomRange] = useState<[string, string]>(['', '']);
  const [statusOpen, setStatusOpen] = useState(false);
  const [status, setStatus] = useState<string[]>([]);
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskQuery, setTaskQuery] = useState('');
  const [taskPick, setTaskPick] = useState<string[]>([]);

  const closeAll = useCallback(() => {
    setBizOpen(false);
    setDateOpen(false);
    setStatusOpen(false);
    setTaskOpen(false);
  }, []);

  /*
   * 点空白处 / 按 Esc 关闭筛选浮层。
   *
   * 之前只有 toolbar 的 onMouseLeave, 桌面端移出能关、移动端却关不掉：
   * 手指点空白不会触发 mouseleave, 浮层会一直盖在作品上。事件挂在 document
   * 上并排除 toolbar 内部 (浮层本身也在 toolbar 里), 选择筛选时不会误关。
   */
  useEffect(() => {
    if (!bizOpen && !dateOpen && !statusOpen && !taskOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest('.my-works-toolbar')) return;
      setBizOpen(false);
      setDateOpen(false);
      setStatusOpen(false);
      setTaskOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBizOpen(false);
        setDateOpen(false);
        setStatusOpen(false);
        setTaskOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [bizOpen, dateOpen, statusOpen, taskOpen]);

  // ── 真实过滤（全部基于本地任务数据，不做假筛选）──
  const filtered = useMemo(() => {
    const now = new Date();
    return tasks.filter((t) => {
      // 页签是第一道切分: 图片 / 视频互不混排
      if ((tab === 'video') !== (taskModality(t) === 'video')) return false;
      if (biz.length > 0 && !biz.includes(t.capability)) return false;
      if (status.length > 0) {
        const bucket = t.status === 'succeeded' ? 'succeeded' : t.status === 'failed' ? 'failed' : 'running';
        if (!status.includes(bucket)) return false;
      }
      if (taskPick.length > 0 && !taskPick.includes(t.id)) return false;
      const ts = t.createdAt ? new Date(t.createdAt).getTime() : 0;
      if (datePreset === 'today' && ts < startOfDay(now)) return false;
      if (datePreset === 'yesterday') {
        const y = startOfDay(now) - 86400000;
        if (ts < y || ts >= startOfDay(now)) return false;
      }
      if (datePreset === '7d' && ts < startOfDay(now) - 6 * 86400000) return false;
      if (datePreset === 'custom' && customRange[0] && customRange[1]) {
        const from = startOfDay(new Date(customRange[0]));
        const to = startOfDay(new Date(customRange[1])) + 86400000;
        if (ts < from || ts >= to) return false;
      }
      return true;
    });
  }, [tasks, tab, biz, status, taskPick, datePreset, customRange]);

  const sorted = useMemo(
    () =>
      [...filtered].sort(
        (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
      ),
    [filtered],
  );

  const activeFilterCount =
    biz.length + status.length + taskPick.length + (datePreset === 'all' ? 0 : 1);

  const toggleIn: ToggleIn = useCallback(
    (arr, v, set) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]),
    [],
  );

  /** 「清除筛选」：只清筛选，不动页签与勾选（勾选由调用方随筛选变化一并清空） */
  const clearAll = useCallback(() => {
    setBiz([]);
    setStatus([]);
    setTaskPick([]);
    setDatePreset('all');
    setCustomRange(['', '']);
  }, []);

  /*
   * 业务类型按**产出模态**收集，而不是写死 group id。
   *
   * 之前图片页写死 ecommerce_gen/ai_retouch，导致 group 为 ai_video、
   * 但 modality=image 的 free_create 在图片页没有筛选项；视频页又会出现
   * 一个永远筛出空结果的组。现在从能力清单的 modality 推导分组，
   * 并对「图片页里的 ai_video 组」如实改名为「自由创作」，避免名实不符。
   */
  const bizGroups = useMemo<WorksBizGroup[]>(() => {
    const items = caps?.items ?? [];
    const groups = caps?.groups ?? [];
    const modalItems = items.filter((i) => (i.modality ?? 'image') === tab);
    const groupIds = new Set(modalItems.map((i) => i.group));
    return groups
      .filter((g) => groupIds.has(g.id))
      .map((g) => ({
        name: tab === 'image' && g.id === 'ai_video' ? '自由创作' : g.name,
        items: modalItems.filter((i) => i.group === g.id),
      }))
      .filter((g) => g.items.length > 0);
  }, [caps, tab]);

  const matchedTasks = useMemo(() => {
    const q = taskQuery.trim();
    if (!q) return tasks.slice(0, 20);
    return tasks
      .filter((t) => capabilityName(t.capability).includes(q) || t.id.includes(q))
      .slice(0, 20);
  }, [tasks, taskQuery]);

  return {
    // 业务类型
    biz,
    setBiz,
    bizOpen,
    setBizOpen,
    bizGroups,
    // 日期
    datePreset,
    setDatePreset,
    dateOpen,
    setDateOpen,
    customRange,
    setCustomRange,
    // 状态
    status,
    setStatus,
    statusOpen,
    setStatusOpen,
    // 所属任务
    taskQuery,
    setTaskQuery,
    taskOpen,
    setTaskOpen,
    taskPick,
    setTaskPick,
    matchedTasks,
    // 派生与动作
    sorted,
    activeFilterCount,
    closeAll,
    toggleIn,
    clearAll,
  };
}

/** 工具栏需要的筛选面（`WorksToolbar` 的 props 与之同名，页面可直接展开传入） */
export type WorksFilters = ReturnType<typeof useWorksFilters>;
