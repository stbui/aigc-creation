import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConfirm } from '../../../admin-ui/providers/ConfirmProvider';
import { useToast } from '../../../admin-ui/providers/ToastProvider';
import { useAdminDetailParam, useAdminResource } from '../../../components/admin/AdminWidgets';
import { useAdmin } from '../../../context/AdminContext';
import { useDiscardConfirm, useUnsavedGuard } from '../../../hooks/useUnsavedGuard';
import type { AdminChannelView } from '../../../types/model';
import { fetchAllChannels, fetchChannelHealth } from './api';
import type { ChannelHealthSummary } from './constants';

/**
 * 渠道工作台的 hook 入口 —— 目录内文件的唯一外部 hook 来源。
 *
 * 约定: `channels/` 下的文件不从 `src/admin-ui/providers` / `src/context` /
 * `src/hooks` / `src/components` 直接取 hook, 一律经由本文件 —— 页面用到的
 * 外部 hook 集中可见, 换实现或加埋点只改一处。
 * 目录内新增外部 hook 引用时在这里补一行 re-export。
 *
 * 本文件自己的 `useChannelList` / `useChannelFilters` / `useChannelHealth`
 * 只服务渠道工作台, 与外部 hook 一起从这里出去。
 */
export {
  useAdmin,
  useAdminDetailParam,
  useAdminResource,
  useConfirm,
  useDiscardConfirm,
  useToast,
  useUnsavedGuard,
};

/**
 * 渠道列表：全量拉取 + 手动刷新。
 *
 * 失败时保留上一次结果（由页面决定是展示错误还是空态），不把整页塌成错误。
 */
export function useChannelList() {
  const [rows, setRows] = useState<AdminChannelView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchAllChannels());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取渠道列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { rows, loading, error, reload };
}

/**
 * 关键字 / 状态筛选。
 *
 * 列表已经全量在内存，筛选完全本地化：切筛选不触发请求。
 */
export function useChannelFilters(rows: AdminChannelView[]) {
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>(undefined);

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter((row) => {
      const hitKeyword =
        !kw || row.name.toLowerCase().includes(kw) || row.baseUrl.toLowerCase().includes(kw);
      const hitStatus = !status || (status === 'enabled' ? row.enabled : !row.enabled);
      return hitKeyword && hitStatus;
    });
  }, [rows, keyword, status]);

  const clearFilters = useCallback(() => {
    setKeyword('');
    setStatus(undefined);
  }, []);

  return {
    keyword,
    status,
    setKeyword,
    setStatus,
    visible,
    clearFilters,
    hasFilters: Boolean(keyword.trim() || status),
  };
}

/**
 * 线路健康 + 渠道级 24h 汇总。
 *
 * 健康指标与渠道列表是两份数据：列表只关心「有哪些渠道」，
 * 健康按线路全量取（运营要看的是「哪条线在坏」）。
 */
export function useChannelHealth() {
  const resource = useAdminResource(() => fetchChannelHealth());
  const rows = resource.data?.items ?? [];

  const byChannel = useMemo(() => {
    const map = new Map<string, ChannelHealthSummary>();
    for (const row of rows) {
      const day = row.windows?.day;
      if (!day) continue;
      const current = map.get(row.channelId) ?? { samples: 0, success: 0 };
      map.set(row.channelId, {
        samples: current.samples + day.samples,
        success: current.success + day.success,
      });
    }
    return map;
  }, [rows]);

  return {
    rows,
    byChannel,
    loading: resource.loading,
    error: resource.error,
    reload: resource.reload,
  };
}
