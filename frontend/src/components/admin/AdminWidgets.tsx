import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { App, Drawer } from 'antd';
import { PageHeader } from './PageHeader';
import { LoadFailedPage } from '../ExceptionPage';
import { StateEmpty, StateError, StateLoading, StateSkeleton } from '../StateViews';

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

/**
 * 列表页统一骨架: 保持布局稳定, 避免内容跳动。
 *
 * 2026-10-20: 原为 antd `<Spin size="large" tip>` 配一个 120×120 空 div。
 * 改用骨架屏 —— 空 div 撑不出真实列表的高度, 数据到达时仍会跳动。
 */
export function AdminListLoading({ tip = '加载中…' }: { tip?: string }) {
  return (
    <div className="adm-page-loading">
      <StateSkeleton variant="panel" count={5} />
      <p className="adm-page-loading-tip">{tip}</p>
    </div>
  );
}

/** 列表页统一失败态: 保留筛选条件, 给出重试 */
export function AdminListError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <LoadFailedPage message={error} onRetry={onRetry} />;
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

  return (
    <Drawer
      title={title}
      width={720}
      open={open}
      onClose={onClose}
      className="adm-drawer"
      destroyOnClose
      footer={data && footer ? <div className="adm-drawer-footer">{footer(data)}</div> : undefined}
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
 * 高危操作确认弹窗。
 *
 * 两条硬规则 (来自 docs/admin-ui-design.md §2.5):
 *   1. 必须量化影响 —— 写「将删除相关数据」等于没写
 *   2. 破坏性操作必须输入确认词 —— 防止误触
 */
export function ConfirmAction({
  open,
  title,
  description,
  impact,
  danger = false,
  requireTyping,
  typingText,
  confirmText = '确认',
  loading = false,
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
  requireTyping?: boolean;
  typingText?: string;
  confirmText?: string;
  loading?: boolean;
  extra?: ReactNode;
  onCancel: () => void;
  onConfirm: (typed: string) => void;
}) {
  const [typed, setTyped] = useState('');
  const { message } = App.useApp();

  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const ready = !requireTyping || typed.trim() === (typingText ?? '');

  const confirm = () => {
    if (!ready) {
      void message.warning(`请输入「${typingText}」以确认`);
      return;
    }
    onConfirm(typed);
  };

  return (
    <div className="adm-modal-mask" onClick={loading ? undefined : onCancel}>
      <div className="adm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <div className="adm-modal-title">{title}</div>

        <div className="adm-modal-body">
          {description}

          {impact && impact.length > 0 && (
            <div className="adm-confirm-impact">
              <div className="adm-confirm-impact-title">影响范围：</div>
              <ul>
                {impact.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          {extra}

          {requireTyping && (
            <div className="adm-confirm-typing">
              <label htmlFor="adm-confirm-input">请输入「{typingText}」以确认：</label>
              <input
                id="adm-confirm-input"
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={typingText}
                autoComplete="off"
              />
            </div>
          )}
        </div>

        <div className="adm-modal-footer">
          <button type="button" className="adm-btn" onClick={onCancel} disabled={loading}>
            取消
          </button>
          <button
            type="button"
            className={`adm-btn ${danger ? 'is-danger' : 'is-primary'}`}
            onClick={confirm}
            disabled={loading || !ready}
          >
            {loading ? '处理中…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export { PageHeader };