import { useCallback, useEffect, useState } from 'react';

import { projectsApi } from './api';
import { useAuth } from './hooks';
import type { ProjectListItem } from '../../types/api';

/**
 * 素材库项目列表。
 *
 * 同时服务于项目分组、上传目标与项目管理弹窗。与素材列表分开是因为它的失败
 * 不该阻断素材浏览 —— 拉不到项目名时分组仍用 id 兜底，页面照常可用。
 */
export function useLibraryProjects() {
  const { token } = useAuth();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);

  const refreshProjects = useCallback(async () => {
    if (!token) {
      setProjects([]);
      return [] as ProjectListItem[];
    }
    const list = await projectsApi.list();
    setProjects(list);
    return list;
  }, [token]);

  useEffect(() => {
    if (!token) {
      setProjects([]);
      return;
    }
    void refreshProjects().catch(() => {
      /* 拉不到项目名时分组仍用 id 兜底，不阻断素材浏览 */
    });
  }, [refreshProjects, token]);

  return { projects, refreshProjects };
}
