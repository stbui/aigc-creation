import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * 后台列表 / 单资源数据 hook。
 *
 * 数据逻辑与渲染无关，只保留一份 —— 各页面各存一套的话，「失败不清空数据」
 * 「筛选变更重置页码」这类行为迟早会分叉。
 */

/**
 * 服务端分页列表。
 *
 * 处理三件容易出错的事：
 *   1. 请求竞态 —— 慢响应不得覆盖新响应（请求序号校验）；
 *   2. 失败不清空 —— 保留上一次数据，翻页失败时页面不会整块变空；
 *   3. 筛选变更重置页码 —— 否则会停在第 5 页而新筛选只有 2 页，显示空表。
 */
export function useAdminList<T>(
  fetcher: (params: Record<string, unknown>) => Promise<T>,
  initialParams: Record<string, unknown> = {},
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({
    page: 1,
    pageSize: 20,
    ...initialParams,
  });

  const seq = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(() => {
    const current = ++seq.current;
    setLoading(true);
    fetcherRef
      .current(params)
      .then((d) => {
        if (current !== seq.current) return; // 已有更新的请求在飞
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (current !== seq.current) return;
        setError(e instanceof Error ? e.message : '加载失败');
      })
      .finally(() => {
        if (current === seq.current) setLoading(false);
      });
  }, [params]);

  useEffect(() => {
    load();
  }, [load]);

  /** 更新查询参数。筛选变更必须重置页码，否则停在越界页码显示空表。 */
  const setQuery = useCallback((patch: Record<string, unknown>, resetPage = true) => {
    setParams((p) => ({ ...p, ...patch, ...(resetPage ? { page: 1 } : {}) }));
  }, []);

  const setPage = useCallback((page: number, pageSize?: number) => {
    setParams((p) => ({ ...p, page, ...(pageSize ? { pageSize } : {}) }));
  }, []);

  return { data, loading, error, params, setQuery, setPage, reload: load };
}

/**
 * 单对象 / 整表数据。
 *
 * 面向没有分页的「拉一份配置 / 一整个清单」，同样需要三件事：竞态保护、
 * 失败不清空、`silent` 轮询（定时任务页 30s 轮询时按钮不该每 30 秒闪一次转圈）。
 *
 * `deps` 变化即重新拉取，语义与 `useEffect` 依赖数组一致，必须传**定长**数组。
 */
export function useAdminResource<T>(fetcher: () => Promise<T>, deps: readonly unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const seq = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const current = ++seq.current;
    if (!opts?.silent) setLoading(true);
    try {
      const next = await fetcherRef.current();
      if (current !== seq.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (current !== seq.current) return;
      // 保留上一次数据：刷新失败时页面仍可读，只是上方给提示
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      if (current === seq.current && !opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);

  return { data, loading, error, reload: load };
}

type UrlFilterValue = string | number | boolean | undefined | null;

/**
 * 从**实时地址栏**取当前查询参数。
 *
 * 不能用 `useSearchParams()` 给的快照：那只是本次渲染开始时的值。同一轮里
 * 两个 hook 先后写 URL（筛选写回 + `?id=` 详情）时，第二个写者拿到的快照里
 * 还没有第一个写者刚写进去的键，于是它把对方的键冲掉 ——
 * 「从全部模型点编辑」跳回渠道时 `?id=` 就是这样丢的。
 *
 * 实时值取自 `window.location.search`，每次写之前重新读一次。
 */
function currentSearchParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

/**
 * 已生效的筛选条件 → 地址栏同步（单向写回）。
 *
 * 三条刻意约束：
 *   · 只同步传入的键 —— 分页、排序这类瞬时状态不进 URL，分享链接不会停在第 7 页；
 *   · 用 `replace` —— 每筛一次都压一条历史，后退键就再也退不出页面了；
 *   · 其它查询参数原样保留 —— 详情抽屉的 `?id=` 不受影响。
 *
 * 读取侧由页面在 `useState` 初始化时完成（同步，避免先发一次空筛选请求）。
 */
export function useAdminUrlFilterSync(applied: Record<string, UrlFilterValue>) {
  const [, setSearchParams] = useSearchParams();
  // setSearchParams 的引用随 searchParams 变化；放进依赖会让「写 URL → 引用变 →
  // 再写一次」多跑一轮。用 ref 取最新实现，只按筛选内容变化触发。
  const setSearchParamsRef = useRef(setSearchParams);
  setSearchParamsRef.current = setSearchParams;

  // undefined 也要占位，否则「重置」时 JSON 会丢掉该键，URL 上的旧筛选清不掉
  const serialized = JSON.stringify(applied, (_key, value) =>
    value === undefined ? null : value,
  );

  useEffect(() => {
    const values = JSON.parse(serialized) as Record<string, UrlFilterValue>;
    setSearchParamsRef.current(
      () => {
        // 从实时地址栏取 prev，不用 hook 的快照 —— 别的 hook 刚写进去的键不能丢
        const next = currentSearchParams();
        for (const [key, value] of Object.entries(values)) {
          next.delete(key);
          if (value !== undefined && value !== null && value !== '') next.set(key, String(value));
        }
        return next;
      },
      { replace: true },
    );
  }, [serialized]);
}

/**
 * 详情抽屉与地址栏 `?id=` 的双向同步。
 *
 * 任务与工单原先只支持「带 id 进来」，从列表打开详情却不写回地址栏：刷新后
 * 详情消失、分享链接也打不开同一条记录。这里把 id 作为唯一真相，打开即写入、
 * 关闭即移除；筛选写回仍由 `useAdminUrlFilterSync` 负责，两边基于
 * URLSearchParams 合并，不互相覆盖。
 *
 * 参数名可定制（`param = 'id'`）：同一页里可能同时存在两类抽屉（支付页的
 * 订单详情 `orderId` 与对账明细 `runId`），语义不同就不能共用 `id`。
 * 默认值不变，既有调用方无需改动。
 */
export function useAdminDetailParam(param = 'id') {
  const [searchParams, setSearchParams] = useSearchParams();
  const id = searchParams.get(param) || null;

  const setId = useCallback(
    (next: string | null) => {
      setSearchParams(
        () => {
          // 从实时地址栏取 prev，不用 hook 的快照 ——
          // 筛选写回可能刚改过同一个 query，同轮里互相覆盖会把对方的键冲掉
          const params = currentSearchParams();
          if (next) params.set(param, next);
          else params.delete(param);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams, param],
  );

  return [id, setId] as const;
}
