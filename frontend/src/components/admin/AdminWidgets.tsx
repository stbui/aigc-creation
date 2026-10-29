import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Button, Drawer, Result, Skeleton } from 'antd';
import { AlertTriangle } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { StateEmpty, StateError, StateLoading } from '../StateViews';

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
 * 列表分页的统一配置 (2026-10-23)。
 *
 * 后台 12 张服务端分页表此前各写一份 `pagination={{...}}`, 差异全是历史遗留:
 * 有的给了 `showSizeChanger` 有的没给、`pageSizeOptions` 只有部分页面写、
 * `showTotal` 的单位有「条 / 张 / 个 / 行」四种写法。运营换个页面就得重新
 * 适应分页器 —— 这不该靠记忆。
 *
 * `unit` 保留各页的计量词 (券用「张」、活动用「个」), 其余一律统一。
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
 * 此前这十来个页面各抄一份 `useState(loading/error)` + `useCallback(load)` +
 * `useEffect`, 差异全在细节上: 有的 `load()` 忘了置 loading、有的没有竞态保护、
 * 有的在 finally 里去 `setData(null)`。收敛成一份, 页面只写 `fetcher` 与依赖。
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

/**
 * 列表页统一骨架: 保持布局稳定, 避免内容跳动。
 *
 * 2026-10-20: 原为 antd `<Spin size="large" tip>` 配一个 120×120 空 div。
 * 改用骨架屏 —— 空 div 撑不出真实列表的高度, 数据到达时仍会跳动。
 */
export function AdminListLoading({ tip = '加载中…' }: { tip?: string }) {
  return (
    <div className="adm-page-loading">
      <Skeleton active paragraph={{ rows: 5 }} />
      <p className="adm-page-loading-tip">{tip}</p>
    </div>
  );
}

/** 列表页统一失败态: 保留筛选条件, 给出重试 */
export function AdminListError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <Result
      status="warning"
      title="加载失败"
      subTitle={error}
      extra={<Button onClick={onRetry}>重试</Button>}
    />
  );
}

/**
 * 刷新失败、但手上有上一次成功的数据 (2026-10-23)。
 *
 * 用 `useAdminResource` / `useAdminList` 之后失败不会清空数据 —— 好处是页面
 * 还能读, 坏处是**页面上每一处的数据都可能已经过期**, 而用户看不出来。
 * 这个条就是补上那句话说清楚: 「下面这些是上次的」, 并就地给重试。
 *
 * 必须在 `error && data` 时渲染; `error && !data` 走 `AdminListError` 整块替换。
 */
export function AdminStaleError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="adm-alert is-danger">
      <AlertTriangle size={16} />
      <div>
        <strong>刷新失败，下面是上一次成功获取的数据</strong>
        <div>{error}</div>
        <div style={{ marginTop: 4 }}>
          <Button size="small" onClick={onRetry}>
            重试
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * 详情抽屉。
 *
 * 懒加载: 打开才请求, 关闭清空 —— 避免打开列表时就为几十条记录各拉一次详情。
 * children 是渲染函数而非元素, 这样详情数据到达前不会渲染出空壳。
 */
export function AdminDrawer<T>({
  open,
  title,
  onClose,
  fetcher,
  children,
  footer,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  fetcher: () => Promise<T>;
  children: (data: T) => ReactNode;
  footer?: (data: T) => ReactNode;
}) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const seq = useRef(0);
  /**
   * 重试计数 —— 失败态的「重试」按钮靠它重新触发拉取。
   * 不能靠 setOpen(v => v): 抽屉的拉取只依赖 open, 值不变就不会重跑。
   */
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!open) {
      setData(null);
      setError(null);
      return;
    }
    const current = ++seq.current;
    setLoading(true);
    setError(null);
    fetcherRef
      .current()
      .then((d) => {
        if (current !== seq.current) return;
        setData(d);
      })
      .catch((e: unknown) => {
        if (current !== seq.current) return;
        setError(e instanceof Error ? e.message : '加载失败');
      })
      .finally(() => {
        if (current === seq.current) setLoading(false);
      });
  }, [open, retryNonce]);

  const footerContent = data && footer ? footer(data) : null;

  return (
    <Drawer
      title={title}
      size={720}
      open={open}
      onClose={onClose}
      className="adm-drawer"
      destroyOnHidden
      footer={
        footerContent ? <div className="adm-drawer-footer">{footerContent}</div> : undefined
      }
    >
      {loading ? (
        <div className="adm-drawer-loading">
          <StateLoading tip="加载详情…" />
        </div>
      ) : error ? (
        /* 失败态: 详情加载失败不该显示成 antd Empty 的"暂无数据" */
        <StateError
          compact
          title="详情加载失败"
          desc="没能取回该条记录详情。"
          detail={error}
          onRetry={() => setRetryNonce((n) => n + 1)}
        />
      ) : data ? (
        children(data)
      ) : (
        <StateEmpty compact title="暂无详情" />
      )}
    </Drawer>
  );
}

/**
 * 高危操作确认区（页面内，不使用弹窗）。
 *
 * 2026-10-26 按产品要求去掉阻塞式确认弹窗：操作仍需要看影响面与填必填项，
 * 但以页面底部的操作条承载，不再遮罩页面、不再强制「输入确认词」。
 * 纯确认类动作（无需填数据）应在调用方直接执行，不必挂这个组件。
 *
 * 仍然保留的两条硬规则 (来自 docs/admin-ui-design.md §2.5):
 *   1. 必须量化影响 —— 写「将删除相关数据」等于没写
 *   2. 危险动作用 danger 标色，并把不可逆后果写在 description 里
 */
export function ConfirmAction({
  open,
  title,
  description,
  impact,
  danger = false,
  confirmText = '确认',
  loading = false,
  confirmDisabled = false,
  extra,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  /** 影响面量化, 如 ['12 个项目', '45 张素材'] */
  impact?: string[];
  danger?: boolean;
  /** @deprecated 不再要求输入确认词，保留入参仅为兼容旧调用 */
  requireTyping?: boolean;
  /** @deprecated 同上 */
  typingText?: string;
  confirmText?: string;
  loading?: boolean;
  /** 影响面仍在加载等场景下阻止误操作 */
  confirmDisabled?: boolean;
  extra?: ReactNode;
  onCancel: () => void;
  onConfirm: (typed: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // 操作条固定在底部；把焦点移进去，键盘用户不必再 Tab 一圈
    panelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [loading, onCancel, open]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className={`adm-inline-confirm${danger ? ' is-danger' : ''}`}
      role="region"
      aria-label={title}
      tabIndex={-1}
    >
      <div className="adm-inline-confirm-head">
        <div className="adm-inline-confirm-title">{title}</div>
        <Button
          type="text"
          size="small"
          aria-label="关闭"
          disabled={loading}
          onClick={onCancel}
        >
          关闭
        </Button>
      </div>

      {description && <div className="adm-inline-confirm-desc">{description}</div>}

      {impact && impact.length > 0 && (
        <Alert
          className="adm-confirm-impact"
          type={danger ? 'error' : 'warning'}
          showIcon
          title={<span className="adm-confirm-impact-title">影响范围</span>}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {impact.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          }
        />
      )}

      {extra}

      <div className="adm-inline-confirm-actions">
        <Button onClick={onCancel} disabled={loading}>
          取消
        </Button>
        <Button
          type="primary"
          danger={danger}
          loading={loading}
          disabled={confirmDisabled}
          onClick={() => onConfirm('')}
        >
          {confirmText}
        </Button>
      </div>
    </div>
  );
}

export { PageHeader };
