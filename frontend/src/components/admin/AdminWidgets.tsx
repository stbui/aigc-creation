import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { USE_BOARDUI_ADMIN } from '../../admin-ui/lib/flag';
import * as boardui from '../../admin-ui/widgets/AdminChrome';
import * as legacy from './AdminWidgets.legacy';
import { PageHeader } from './PageHeader';

/**
 * 后台列表共享控件（入口）。
 *
 * ## 为什么这里只做「分流」
 *
 * 数据逻辑（`useAdminList` / `useAdminResource` / URL 同步 / 分页配置）与渲染
 * 无关，只保留一份 —— 两条渲染路径若各存一份逻辑，「失败不清空数据」「筛选
 * 变更重置页码」这类行为迟早会分叉。
 *
 * 渲染层有两份：`admin-ui/widgets/AdminChrome`（BoardUI）与
 * `AdminWidgets.legacy`（antd 回滚路径），由 `VITE_ADMIN_UI` 决定用哪份。
 * 页面只 `import ... from '../../components/admin/AdminWidgets'`，不感知差异，
 * 29 个页面因此不需要改 import。
 */
const impl = USE_BOARDUI_ADMIN ? boardui : legacy;

/*
 * 逐项标注成 legacy 版的类型而不是让 TS 推导联合类型。
 * `AdminDrawer` 是泛型组件，联合的泛型签名在调用处推不出 T，页面里的
 * `children={(data) => data.xxx}` 会退化成 unknown。legacy 的签名就是契约，
 * BoardUI 版与之逐字一致，这里的 as 不会掩盖真实差异。
 */
export const AdminListLoading: typeof legacy.AdminListLoading = impl.AdminListLoading;
export const AdminListError: typeof legacy.AdminListError = impl.AdminListError;
export const AdminStaleError: typeof legacy.AdminStaleError = impl.AdminStaleError;
export const AdminDrawer: typeof legacy.AdminDrawer = impl.AdminDrawer;
export const ConfirmAction: typeof legacy.ConfirmAction = impl.ConfirmAction;

/**
 * 列表数据 hook。
 *
 * 处理三件容易出错的事:
 *   1. 请求竞态 —— 慢响应不得覆盖新响应 (请求序号校验)
 *   2. 失败不清空 —— 保留上一次数据, 避免翻页失败时页面整块变空
 *   3. 筛选变更重置页码 —— 否则会停在第 5 页而新筛选只有 2 页, 显示空表
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

  /** 更新查询参数。筛选变更必须 resetPage, 否则停在越界页码显示空表 */
  const setQuery = useCallback((patch: Record<string, unknown>, resetPage = true) => {
    setParams((p) => ({ ...p, ...patch, ...(resetPage ? { page: 1 } : {}) }));
  }, []);

  const setPage = useCallback((page: number, pageSize?: number) => {
    setParams((p) => ({ ...p, page, ...(pageSize ? { pageSize } : {}) }));
  }, []);

  return { data, loading, error, params, setQuery, setPage, reload: load };
}

type UrlFilterValue = string | number | boolean | undefined | null;

/**
 * 已生效的筛选条件 → 地址栏同步 (2026-10-29)。
 *
 * 后台列表此前只有部分页面支持从 URL 读取筛选 (告警深链), 但用户把筛选
 * 结果发给同事时地址栏还是裸的 `/admin/orders`。这里做**单向写回**:
 * 页面内点「查询 / 重置」后, 把已生效的条件写进 URL。
 *
 * 三条刻意约束:
 *   · 只同步传入的键 —— 分页、排序这类瞬时状态不进 URL, 分享链接不会
 *     停在第 7 页或某个排序上;
 *   · 用 `replace` —— 每筛一次都压一条历史, 后退键就再也退不出页面了;
 *   · 其它查询参数原样保留 —— 详情抽屉等深链参数不受影响。
 *
 * 读取侧由页面在 `useState` 初始化时完成 (同步, 避免先发一次空筛选请求)。
 */
export function useAdminUrlFilterSync(applied: Record<string, UrlFilterValue>) {
  const [, setSearchParams] = useSearchParams();
  // setSearchParams 的引用随 searchParams 变化；放进依赖会让「写 URL → 引用变 →
  // 再写一次」多跑一轮。这里用 ref 取最新实现，只按筛选内容变化触发。
  const setSearchParamsRef = useRef(setSearchParams);
  setSearchParamsRef.current = setSearchParams;

  // undefined 也要占位, 否则「重置」时 JSON 会丢掉该键, URL 上的旧筛选清不掉
  const serialized = JSON.stringify(applied, (_key, value) =>
    value === undefined ? null : value,
  );

  useEffect(() => {
    const values = JSON.parse(serialized) as Record<string, UrlFilterValue>;
    setSearchParamsRef.current(
      (prev) => {
        const next = new URLSearchParams(prev);
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
 * 详情抽屉与地址栏的 `?id=` 双向同步。
 *
 * 任务与工单原先只支持「带 id 进来」，从列表打开详情却不写回地址栏：
 * 刷新后详情消失、分享链接也打不开同一条记录。这里把 id 作为唯一真相，
 * 打开即写入、关闭即移除；筛选写回仍由 `useAdminUrlFilterSync` 负责，
 * 两边都基于 URLSearchParams 合并，不会互相覆盖。
 */
export function useAdminDetailParam() {
  const [searchParams, setSearchParams] = useSearchParams();
  const id = searchParams.get('id') || null;

  const setId = useCallback(
    (next: string | null) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next) params.set('id', next);
          else params.delete('id');
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [id, setId] as const;
}

/**
 * 列表分页的统一配置 (2026-10-23)。
 *
 * 后台 12 张服务端分页表此前各写一份 `pagination={{...}}`, 差异全是历史遗留:
 * 有的给了 `showSizeChanger` 有的没给、`pageSizeOptions` 只有部分页面写、
 * `showTotal` 的单位有「条 / 张 / 个 / 行」四种写法。运营换个页面就得重新
 * 适应分页器 —— 这不该靠记忆。
 *
 * `unit` 保留各页的计量词 (券用「张」、活动用「个」), 其余一律统一。
 *
 * 注：返回的是 antd Pagination 的配置形状。BoardUI 路径下由 `AdminDataTable`
 * 消费同一份配置并渲染自己的分页器 —— 配置只在一处定义。
 */
export function adminPagination({
  current,
  pageSize,
  total,
  onChange,
  unit = '条',
}: {
  current: number;
  pageSize: number;
  total: number;
  onChange: (page: number, pageSize: number) => void;
  /** 计量词, 默认「条」 */
  unit?: string;
}) {
  return {
    current,
    pageSize,
    total,
    showSizeChanger: true,
    pageSizeOptions: [20, 50, 100],
    showTotal: (t: number) => `共 ${t} ${unit}`,
    onChange,
  };
}

/**
 * 局部小表的分页配置 (2026-10-23)。
 *
 * 抽屉里的明细表、导入结果表这类数据本来就少且只在本页, 用 antd 的
 * **客户端分页** (不分页器自己算 current), 不需要像服务端分页那样把
 * current/total 传进来。此前 4 处各写一份 `{ pageSize: N, ... }`,
 * 单位有「行 / 条」两种、`hideOnSinglePage` 只有两处写。
 */
export function adminMiniPagination({
  pageSize = 20,
  unit = '条',
}: {
  pageSize?: number;
  /** 计量词, 默认「条」 */
  unit?: string;
} = {}) {
  return {
    pageSize,
    // 只有一页时不显示分页器: 它占掉一整行, 却没有可翻的东西
    hideOnSinglePage: true,
    showTotal: (t: number) => `共 ${t} ${unit}`,
  };
}

/**
 * 单对象 / 整表数据的拉取 hook (2026-10-23)。
 *
 * `useAdminList` 面向**服务端分页**的表格 (带 page/pageSize/total); 后台还有
 * 十来个页面只是「拉一份配置 / 一整个清单」—— 没有分页, 但同样需要三件事:
 *   1. 请求竞态保护 (连续点「刷新」或切换筛选时, 慢响应不得覆盖新响应)
 *   2. 失败不清空已加载的数据 (刷新失败不该让整页塌成错误态)
 *   3. `silent` 轮询 (定时任务页 30s 轮询时, 按钮不该每 30 秒闪一次转圈)
 *
 * `deps` 变化即重新拉取 (等价于「筛选条件变了就重查」), 语义与 `useEffect`
 * 的依赖数组一致, 调用处必须传**定长**数组。
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
      // 保留上一次数据: 刷新失败时页面仍可读, 只是上方给了失败提示
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

export { PageHeader };
