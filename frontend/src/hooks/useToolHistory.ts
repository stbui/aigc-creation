import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { generateApi } from '../lib/api';

export type ToolHistoryTask = Awaited<ReturnType<typeof generateApi.list>>[number];

/**
 * 修图工具的历史记录：按能力拉取最近 24 条成功任务。
 *
 * `refreshKey` 通常是当前结果 URL —— 新任务完成时页面拿到的 result 变化，
 * 历史随即重新拉取。
 */
export function useToolHistory(capability: string, refreshKey?: unknown) {
  const { token } = useAuth();
  const [tasks, setTasks] = useState<ToolHistoryTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!token) {
      setTasks([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void generateApi
      .listPage({ capability, limit: 50, offset: 0 })
      .then((page) => {
        if (cancelled) return;
        setTasks(
          page.items
            .filter((task) => task.status === 'succeeded' && task.outputAsset)
            .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
            .slice(0, 24),
        );
      })
      .catch((e) => {
        if (!cancelled) {
          setTasks([]);
          setError((e as Error).message || '历史记录加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [capability, refreshKey, token, reloadKey]);

  return { tasks, loading, error, retry: () => setReloadKey((value) => value + 1) };
}
