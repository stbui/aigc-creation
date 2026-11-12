import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { AssetGroup, GroupBy } from './constants';
import { capabilityName, dateBucket } from './utils';
import type { Asset, ProjectListItem } from '../../types/api';

/**
 * 素材库的分组状态与可见集合。
 *
 * 2026-11-12 从 `page.tsx` 抽出：分组依据 / 当前分组 / URL 同步 / 项目名映射 /
 * 分组计数与筛选后的可见列表，原先与取数、上传、删除混在同一组件里。
 *
 * 分组全部基于已加载素材在客户端真实聚合，不发额外请求；项目分组以项目列表为主，
 * 空项目也要出现在面板上，否则用户无法从这里进入刚建好的项目。
 */

export interface UseLibraryGroupsArgs {
  items: Asset[];
  projects: ProjectListItem[];
}

export function useLibraryGroups({ items, projects }: UseLibraryGroupsArgs) {
  /*
   * 外部入口: 浏览器扩展保存后跳 `/asset-library?projectId=xxx`，直接落在
   * 刚采集进的那个分组上。惰性初始化是为了首帧就分组，不闪一下「全部」。
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const projectIdParam = searchParams.get('projectId');

  /** 分组依据与当前选中的分组（null = 全部分组） */
  const [groupBy, setGroupBy] = useState<GroupBy>(projectIdParam ? 'project' : 'none');
  const [groupKey, setGroupKey] = useState<string | null>(projectIdParam);

  /** 项目分组与 URL 同步，刷新/分享后仍能直接落到同一个项目。 */
  const setProjectParam = useCallback(
    (id: string | null) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (id) next.set('projectId', id); else next.delete('projectId');
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  const selectProjectGroup = useCallback(
    (id: string | null) => {
      setGroupBy('project');
      setGroupKey(id);
      setProjectParam(id);
    },
    [setProjectParam],
  );

  /*
   * 站内跳转 (已在素材库时再点扩展的通知) 不会重建组件，惰性初始化不生效，
   * 故再跟一次参数变化。用户随后手动换分组不受影响 —— 参数没变就不会再触发。
   */
  useEffect(() => {
    if (!projectIdParam) return;
    setGroupBy('project');
    setGroupKey(projectIdParam);
  }, [projectIdParam]);

  /** 单个素材的所属分组（键 / 显示名 / 排序位） */
  const groupOf = useCallback(
    (a: Asset): { key: string; label: string; sort: number } => {
      if (groupBy === 'project') {
        const name = projects.find((p) => p.id === a.projectId)?.name;
        // 项目名还没拉回来时用 id 尾号兜底, 不留空标签
        return { key: a.projectId, label: name ?? `项目 ${a.projectId.slice(-6)}`, sort: 0 };
      }
      if (groupBy === 'capability') {
        if (!a.capability) return { key: '__none', label: '未关联能力', sort: 999 };
        return { key: a.capability, label: capabilityName(a.capability), sort: 0 };
      }
      return dateBucket(a.createdAt);
    },
    [groupBy, projects],
  );

  const groups = useMemo(() => {
    if (groupBy === 'none') return [] as AssetGroup[];
    const map = new Map<string, AssetGroup>();

    // 项目分组以项目列表为主：即使项目里没有素材，也要能在这里看到并进入。
    if (groupBy === 'project') {
      projects.forEach((project, index) => {
        map.set(project.id, {
          key: project.id,
          label: project.name,
          count: 0,
          sort: index,
        });
      });
    }

    for (const a of items) {
      const { key, label, sort } = groupOf(a);
      const hit = map.get(key);
      if (hit) hit.count += 1;
      else map.set(key, { key, label, count: 1, sort });
    }
    return [...map.values()].sort(
      (x, y) => x.sort - y.sort || x.label.localeCompare(y.label, 'zh-CN'),
    );
  }, [items, groupBy, groupOf, projects]);

  // 分组不存在（换了分组依据 / 素材被删）时自动回到「全部」, 不留一个筛不出东西的选中态
  const activeGroup = groups.some((g) => g.key === groupKey) ? groupKey : null;
  const selectedProjectId = groupBy === 'project' ? activeGroup : null;
  const activeProject = selectedProjectId
    ? projects.find((project) => project.id === selectedProjectId) ?? null
    : null;
  const moveTargetProjects = useMemo(
    () => projects.filter((project) => project.id !== selectedProjectId),
    [projects, selectedProjectId],
  );
  const shown = useMemo(
    () => (activeGroup ? items.filter((a) => groupOf(a).key === activeGroup) : items),
    [items, activeGroup, groupOf],
  );

  return {
    groupBy,
    setGroupBy,
    groupKey,
    setGroupKey,
    projectIdParam,
    setProjectParam,
    selectProjectGroup,
    groups,
    activeGroup,
    selectedProjectId,
    activeProject,
    moveTargetProjects,
    shown,
  };
}
