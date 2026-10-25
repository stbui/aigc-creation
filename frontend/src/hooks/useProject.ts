import { useCallback } from 'react';
import { projectsApi } from '../lib/api';
import { DEFAULT_PROJECT_NAME } from '../lib/constants';
import { getToken } from '../lib/auth';

export function useProject() {
  const ensureProject = useCallback(async (): Promise<string> => {
    /*
     * 所有调用方都是**用户主动的写动作**（上传图片、手机上传、提交生成）。
     * `GET /projects` 本身是读请求，api 层按「读请求 401 不弹登录」处理，
     * 所以访客上传时只会看到「请先登录」报错、登录框根本不出现。
     * 这里在发请求前补一次主动触发，把登录墙接回用户真正点击的位置。
     */
    if (!getToken()) {
      window.dispatchEvent(new Event('auth:required'));
      throw new Error('请先登录');
    }
    const list = await projectsApi.list();
    if (list.length > 0) return list[0].id;
    const created = await projectsApi.create(DEFAULT_PROJECT_NAME);
    return created.id;
  }, []);

  return { ensureProject };
}
