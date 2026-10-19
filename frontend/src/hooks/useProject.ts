import { useCallback } from 'react';
import { projectsApi } from '../lib/api';
import { DEFAULT_PROJECT_NAME } from '../lib/constants';

export function useProject() {
  const ensureProject = useCallback(async (): Promise<string> => {
    const list = await projectsApi.list();
    if (list.length > 0) return list[0].id;
    const created = await projectsApi.create(DEFAULT_PROJECT_NAME);
    return created.id;
  }, []);

  return { ensureProject };
}
