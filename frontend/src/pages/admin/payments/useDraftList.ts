import { useCallback, useMemo, useState } from 'react';
import {
  useAdminList,
  useAdminUrlFilterSync,
  type AppliedFilter,
} from '~/admin-ui/primitives';

/**
 * 「草稿 → 应用」两段式列表的共用内核。
 *
 * 支付域的订单 / 对账 / 异常三个列表都用这一套：草稿只留在组件内，点「查询」
 * 才写入请求参数与地址栏。竞态保护、失败不清空、筛选重置页码由 `useAdminList`
 * 负责；这里补上草稿、脏状态、chips 与清除动作，避免三个标签各写一份而分叉。
 *
 * 只在本目录使用 —— 不放进 `admin-ui`，因为它依赖支付域「应用前先按字段表
 * 归一化」的习惯，不是通用后台语义。
 */

export type ListParams = Record<string, unknown> & { page: number; pageSize: number };

interface DraftListOptions<
  TData,
  TValues extends Record<string, unknown>,
  TQuery extends Record<string, unknown>,
> {
  fetcher: (params: ListParams & TQuery) => Promise<TData>;
  /** 首次进入的草稿（来自地址栏，未生效） */
  initial: TValues;
  /** 重置后的空草稿；同时决定 undefined 在草稿里的占位值（空串 / undefined） */
  empty: TValues;
  /** 草稿 → 请求参数；只挑真正要看的数据字段，不含 page / pageSize */
  toQuery: (values: TValues) => TQuery;
  /** 已生效参数 → 地址栏；只同步筛选键，分页不进 URL */
  sync: (params: ListParams & TQuery) => Record<string, string | boolean | undefined>;
  /** 已生效草稿 → 回显 chips；`clear` 一次清一个或多个键（如日期区间） */
  buildChips: (applied: TValues, clear: (keys: Array<keyof TValues>) => void) => AppliedFilter[];
  /** 应用前的规范化（如 trim 关键词），保证草稿与已生效条件同形 */
  normalize?: (values: TValues) => TValues;
  pageSize?: number;
}

export function useDraftList<
  TData,
  TValues extends Record<string, unknown>,
  TQuery extends Record<string, unknown>,
>({
  fetcher,
  initial,
  empty,
  toQuery,
  sync,
  buildChips,
  normalize,
  pageSize = 30,
}: DraftListOptions<TData, TValues, TQuery>) {
  const [values, setValues] = useState<TValues>(initial);
  const [applied, setApplied] = useState<TValues>(initial);

  const { data, loading, error, params, setQuery, setPage, reload } = useAdminList<
    TData,
    ListParams & TQuery
  >(fetcher, { pageSize, ...toQuery(initial) });

  useAdminUrlFilterSync(sync(params));

  const draftChanged = useMemo(
    () => JSON.stringify(toQuery(values)) !== JSON.stringify(toQuery(applied)),
    [applied, toQuery, values],
  );

  const updateFilter = useCallback(
    (key: keyof TValues, value: string | undefined) => {
      setValues((prev) => {
        const next = { ...prev } as Record<string, unknown>;
        next[key as string] = value ?? empty[key];
        return next as TValues;
      });
    },
    [empty],
  );

  const applyFilters = useCallback(() => {
    const next = normalize ? normalize(values) : values;
    setValues(next);
    setApplied(next);
    setQuery(toQuery(next));
  }, [normalize, setQuery, toQuery, values]);

  const resetFilters = useCallback(() => {
    setValues(empty);
    setApplied(empty);
    setQuery(toQuery(empty));
  }, [empty, setQuery, toQuery]);

  /** 用 URL / 后端能力清单清洗后的条件整体替换草稿与已生效值。 */
  const replaceFilters = useCallback(
    (next: TValues) => {
      setValues(next);
      setApplied(next);
      setQuery(toQuery(next));
    },
    [setQuery, toQuery],
  );

  const clearFilters = useCallback(
    (keys: Array<keyof TValues>) => {
      // 按 key 逐个覆盖：union key 直接写入会被 TS 收窄成 never，这里用字典中转
      const nextValues = { ...values } as Record<string, unknown>;
      const nextApplied = { ...applied } as Record<string, unknown>;
      for (const key of keys) {
        nextValues[key as string] = empty[key];
        nextApplied[key as string] = empty[key];
      }
      setValues(nextValues as TValues);
      setApplied(nextApplied as TValues);
      setQuery(toQuery(nextApplied as TValues));
    },
    [applied, empty, setQuery, toQuery, values],
  );

  const appliedChips = useMemo(
    () => buildChips(applied, clearFilters),
    [applied, buildChips, clearFilters],
  );

  return {
    data,
    loading,
    error,
    values,
    applied,
    updateFilter,
    applyFilters,
    resetFilters,
    replaceFilters,
    clearFilters,
    draftChanged,
    appliedChips,
    setPage,
    reload,
  };
}
