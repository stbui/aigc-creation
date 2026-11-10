import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useConfirm } from '../../../admin-ui/providers/ConfirmProvider';
import { useToast } from '../../../admin-ui/providers/ToastProvider';
import { useAdminDetailParam, useAdminResource, useAdminUrlFilterSync } from '../../../admin-ui/primitives';
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
  useAdminUrlFilterSync,
  useConfirm,
  useDiscardConfirm,
  useToast,
  useUnsavedGuard,
};
export { useCapabilities } from '../../../hooks/useCapabilities';

export type ChannelView = 'channels' | 'models';

/**
 * 渠道工作台视图与地址栏的双向同步。
 *
 * 视图直接由 `?view=` 派生，而不是复制进 `useState`：刷新、分享链接以及浏览器
 * 前进 / 后退都会走同一份真相，不会出现地址栏已是「供应商」、页面仍停在
 * 「商品台账」的割裂状态。默认视图不写冗余参数，切到供应商视图才落 `view=channels`。
 *
 * 带 `?id=` 的深链（来自任务详情、能力卡、调用记录）一律按供应商视图处理：
 * 这些入口的目标是“看某条渠道”，切到商品台账会把目标藏起来。
 */
export function useChannelView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view: ChannelView =
    searchParams.get('view') === 'channels' || searchParams.get('id') ? 'channels' : 'models';

  const setView = useCallback(
    (next: ChannelView) => {
      setSearchParams(
        () => {
          // 同一轮里详情也可能刚写过 `?id=`；必须基于实时地址栏合并，不能用旧快照
          const params = new URLSearchParams(window.location.search);
          if (next === 'channels') {
            params.set('view', 'channels');
          } else {
            // 商品台账不绑定某条渠道；留着 `?id=` 会让视图推导又落回供应商
            params.delete('view');
            params.delete('id');
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [view, setView] as const;
}

interface UseChannelSelectionOptions {
  visible: AdminChannelView[];
  loading: boolean;
  error: string | null;
  view: ChannelView;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
}

/**
 * 让「左列可见项」与「右侧详情」始终对齐。
 *
 * 列表首次加载、无效深链、筛选把当前渠道隐藏时，都回退到首个可见渠道；
 * 没有任何可见渠道则清掉失效的 `id`。列表加载中或失败时不动 URL，避免把
 * 旧数据状态误判成「渠道不存在」。
 */
export function useChannelSelection({
  visible,
  loading,
  error,
  view,
  selectedId,
  setSelectedId,
}: UseChannelSelectionOptions) {
  useEffect(() => {
    if (view !== 'channels' || loading || error) return;
    if (selectedId && visible.some((row) => row.id === selectedId)) return;

    if (visible.length > 0) {
      setSelectedId(visible[0].id);
    } else if (selectedId) {
      setSelectedId(null);
    }
  }, [view, loading, error, visible, selectedId, setSelectedId]);
}

/**
 * 单飞动作锁：同步拒绝重复触发，直到前一个 Promise 结束。
 *
 * `disabled={saving}` 要等下一次渲染才生效，快速双击仍可能在上一次请求发出前
 * 再次进入处理器；这里的 ref 在第一次调用的同步阶段就占锁，负责补上这段窗口。
 */
export function useActionLock() {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const run = useCallback(async (task: () => Promise<void>) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      await task();
      return true;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, run };
}

/**
 * 渠道列表：全量拉取 + 手动刷新。
 *
 * 失败时保留上一次结果（由页面决定是展示错误还是空态），不把整页塌成错误。
 */
export function useChannelList() {
  const [rows, setRows] = useState<AdminChannelView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const current = ++seq.current;
    setLoading(true);
    try {
      const next = await fetchAllChannels();
      if (current !== seq.current) return;
      setRows(next);
      setError(null);
    } catch (e) {
      if (current !== seq.current) return;
      setError(e instanceof Error ? e.message : '读取渠道列表失败');
    } finally {
      if (current === seq.current) setLoading(false);
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
