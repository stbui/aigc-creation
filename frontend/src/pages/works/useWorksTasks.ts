import { useCallback, useEffect, useRef, useState } from 'react';

import { generateApi } from './api';
import { SERVER_PAGE_SIZE } from './constants';
import { useApp, useAuth } from './hooks';
import type { Task } from '../../types/api';

/**
 * 我的作品 · 任务列表取数。
 *
 * 首屏取一页即退出骨架屏，后续页由「加载更多」按需请求；筛选只作用于已加载的
 * 本地全集，因此这里不感知筛选条件。失败态与空态分开暴露：刷新失败保留上一次
 * 数据，不能让用户误以为作品丢了。
 */

export interface UseWorksTasksArgs {
  /** 首屏（或刷新）成功后回调：页面据此把可见条数收敛回第一页 */
  onLoaded?: () => void;
  /** 追加一页成功后回调：页面据此把可见条数向前推进一页 */
  onPageLoaded?: () => void;
}

export function useWorksTasks({ onLoaded, onPageLoaded }: UseWorksTasksArgs = {}) {
  const { message } = useApp();
  const { token } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [totalTasks, setTotalTasks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 已加载条数（加载更多时作为 offset） */
  const loadedCountRef = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await generateApi.listPage({
        limit: SERVER_PAGE_SIZE,
        offset: 0,
        excludeFailed: true,
      });
      // 服务端已排除失败 / 取消任务；前端再兜一层，避免旧后端 / 缓存响应把无产出
      // 终态卡带回来。
      setTasks(
        page.items.filter((task) => task.status !== 'failed' && task.status !== 'cancelled'),
      );
      setTotalTasks(page.total);
      loadedCountRef.current = page.items.length;
      onLoaded?.();
    } catch (caught) {
      // 保留上一次数据: 刷新失败不该把已看到的作品清空
      setError((caught as Error).message || '作品列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [onLoaded]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loadedCountRef.current >= totalTasks) return;
    setLoadingMore(true);
    try {
      const page = await generateApi.listPage({
        limit: SERVER_PAGE_SIZE,
        offset: loadedCountRef.current,
        excludeFailed: true,
      });
      const items = page.items.filter(
        (task) => task.status !== 'failed' && task.status !== 'cancelled',
      );
      setTasks((prev) => [...prev, ...items]);
      loadedCountRef.current += page.items.length;
      setTotalTasks(page.total);
      onPageLoaded?.();
    } catch (caught) {
      message.error((caught as Error).message || '作品加载失败');
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, message, onPageLoaded, totalTasks]);

  // 依赖 token: 登录 / 退出都要重新拉取 (与 StatsPage 同构)
  useEffect(() => {
    if (!token) {
      // guest: 作品接口需鉴权, 不发无谓请求 —— 否则首屏会先闪一次「加载失败」
      setTasks([]);
      setTotalTasks(0);
      setError(null);
      loadedCountRef.current = 0;
      setLoading(false);
      return;
    }
    void load();
  }, [token, load]);

  /** 重试受理后先插一张进行中的卡，用户立刻能看到任务已被受理 */
  const addPendingTask = useCallback((task: Task) => {
    setTasks((prev) => [task, ...prev]);
  }, []);

  /** 删除成功后本地摘掉任务，避免为一个已删任务重新拉整页 */
  const dropTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== id));
  }, []);

  return {
    tasks,
    totalTasks,
    loading,
    loadingMore,
    error,
    load,
    loadMore,
    addPendingTask,
    dropTask,
  };
}
