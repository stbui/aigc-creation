import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Drawer, Result, Skeleton } from 'antd';
import { AlertTriangle } from 'lucide-react';
import { StateEmpty, StateError, StateLoading } from '../StateViews';

/**
 * 列表页共享控件的 antd 实现（回滚路径）。
 *
 * `VITE_ADMIN_UI=legacy` 时由 `AdminWidgets.tsx` 整体切回这一份。
 * 业务逻辑（`useAdminList` 等 hook）不在这里 —— 它们与渲染无关，只保留一份，
 * 避免两条路径对「失败不清空数据」「筛选变更重置页码」这类行为产生分歧。
 */

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
  /** 失败态的「重试」按钮靠它重新触发拉取；抽屉的拉取只依赖 open，值不变就不会重跑 */
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
 * 2026-10-26 按产品要求去掉阻塞式确认弹窗：操作仍需要看影响面，但以页面底部
 * 的操作条承载，不再遮罩页面、不再强制「输入确认词」。
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
        <Button type="text" size="small" aria-label="关闭" disabled={loading} onClick={onCancel}>
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
