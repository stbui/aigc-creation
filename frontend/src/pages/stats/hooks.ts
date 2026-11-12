/**
 * 数据中心页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 通用登录态 / SEO 从 `src` 转出；只服务本页的取数逻辑直接定义在这里。
 */

import { useCallback, useEffect, useState } from 'react';

import type { StatsOverview } from '../../types/api';
import { statsApi } from './api';

/** 登录态: 未登录不请求需鉴权的统计接口 */
export { useAuth } from '../../context/AuthContext';
/** 路由级 SEO 元信息 */
export { useDocumentMeta } from '../../hooks/useDocumentMeta';

/**
 * 创作数据总览。
 *
 * 加载失败与「没有统计数据」分开：失败时给出错误文案并保留重试入口；
 * 刷新失败保留上次已加载的数据，不让整页突然消失。
 * 有生成中的创作时每 15 秒后台刷新一次（仅页面可见时）。
 */
export function useStatsOverview(token: string | null) {
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    setError(null);
    statsApi
      .overview()
      .then((overview) => {
        setStats(overview);
        setLastUpdated(new Date());
      })
      .catch((cause: unknown) => {
        console.warn('[stats] 创作数据加载失败', cause);
        setError(cause instanceof Error ? cause.message : '创作数据加载失败');
        if (mode === 'initial') setStats(null);
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  // 依赖 token: 登录成功 / 退出都会触发重新拉取。
  useEffect(() => {
    if (!token) {
      setStats(null);
      setLastUpdated(null);
      setLoading(false);
      return;
    }
    load();
  }, [token, load]);

  // 有生成中的创作时后台刷新，完成后自动显示最新作品。
  useEffect(() => {
    if (!token || !stats?.totals.running) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load('refresh');
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [load, stats?.totals.running, token]);

  const refresh = useCallback(() => load('refresh'), [load]);
  const reload = useCallback(() => load('initial'), [load]);

  return { stats, loading, refreshing, lastUpdated, error, refresh, reload };
}
