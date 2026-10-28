import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Popover } from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  AlertOctagon,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Info,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { adminApi } from '../../lib/api';
import type { AdminAlertItem, AdminAlertSeverity, AdminAlertsResult } from '../../types/api';

/**
 * 告警中心的数据来源。
 *
 * 顶栏铃铛与 /admin/alerts 页共用这一份 hook：
 *   · 60 秒轮询一次，但页面在后台标签页时跳过（避免无人看时也持续打库）
 *   · 失败保留上一次数据，只在上方提示，不把已有告警清空
 *   · 请求序号校验，避免慢响应覆盖新响应
 */
export function useAdminAlerts() {
  const [data, setData] = useState<AdminAlertsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const load = useCallback(async (silent = false) => {
    const current = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const next = await adminApi.alerts();
      if (current !== seq.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (current !== seq.current) return;
      setError(e instanceof Error ? e.message : '告警加载失败');
    } finally {
      if (current === seq.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = (silent: boolean) => {
      if (!alive) return;
      if (document.visibilityState === 'hidden') return;
      void load(silent);
    };
    void load();
    const timer = window.setInterval(() => tick(true), 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return { data, error, loading, reload: load };
}

export const ALERT_SEVERITY_META: Record<
  AdminAlertSeverity,
  { label: string; icon: LucideIcon; tone: string }
> = {
  critical: { label: '紧急', icon: AlertOctagon, tone: 'danger' },
  warning: { label: '需处理', icon: AlertTriangle, tone: 'warn' },
  info: { label: '提示', icon: Info, tone: 'info' },
};

export function alertTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false });
}

function AlertRow({
  item,
  onOpen,
}: {
  item: AdminAlertItem;
  onOpen: (link: string) => void;
}) {
  const meta = ALERT_SEVERITY_META[item.severity];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      className={`adm-bell-item is-${item.severity}`}
      onClick={() => onOpen(item.link)}
      title={item.detail}
    >
      <Icon size={16} className="adm-bell-item-icon" aria-hidden="true" />
      <span className="adm-bell-item-main">
        <span className="adm-bell-item-title">{item.title}</span>
        <span className="adm-bell-item-detail">{item.detail}</span>
      </span>
      {item.count !== null && <span className="adm-bell-item-count">{item.count}</span>}
    </button>
  );
}

export function AdminAlertBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data, error, loading, reload } = useAdminAlerts();

  const items = data?.items ?? [];
  const hidden = Math.max(items.length - 5, 0);
  const count = items.length;

  const content = (
    <div className="adm-bell-panel">
      <div className="adm-bell-head">
        <strong>待处理告警</strong>
        <span>{count > 0 ? `${count} 项` : '暂无'}</span>
      </div>

      {error && (
        <div className="adm-bell-error" role="status">
          <span>{error}</span>
          <button type="button" onClick={() => void reload()}>
            重试
          </button>
        </div>
      )}

      {loading && !data ? (
        <div className="adm-bell-empty">正在检查待处理事项…</div>
      ) : error && !data ? (
        /*
         * 首次加载失败时不能落到下面的「当前没有待处理告警」分支 ——
         * 那会把「查不到」说成「没有问题」，比不显示更危险。
         */
        <div className="adm-bell-empty">
          <AlertOctagon size={20} aria-hidden="true" />
          <strong>告警加载失败</strong>
          <span>请稍后重试，或到告警中心查看。</span>
        </div>
      ) : items.length === 0 ? (
        <div className="adm-bell-empty">
          <CheckCircle2 size={20} aria-hidden="true" />
          <strong>当前没有待处理告警</strong>
          <span>
            {data ? `截至 ${alertTime(data.generatedAt)} · 每 60 秒检查` : '每 60 秒检查一次'}
          </span>
        </div>
      ) : (
        <div className="adm-bell-list">
          {items.slice(0, 5).map((item) => (
            <AlertRow
              key={item.key}
              item={item}
              onOpen={(link) => {
                setOpen(false);
                navigate(link);
              }}
            />
          ))}
        </div>
      )}

      <div className="adm-bell-foot">
        <span>
          {data ? `截至 ${alertTime(data.generatedAt)}` : '等待数据'}
          {hidden > 0 ? ` · 另有 ${hidden} 项` : ''}
        </span>
        <button
          type="button"
          className="adm-bell-more"
          onClick={() => {
            setOpen(false);
            navigate('/admin/alerts');
          }}
        >
          查看全部
        </button>
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
      arrow={false}
      styles={{ content: { padding: 0 } }}
    >
      <button
        type="button"
        className="adm-icon-btn adm-bell-btn"
        aria-label={count > 0 ? `告警中心，${count} 项待处理` : '告警中心，暂无待处理'}
        title={count > 0 ? `${count} 项待处理告警` : '告警中心'}
      >
        <Badge count={count} size="small" offset={[2, -2]}>
          <Bell size={17} />
        </Badge>
      </button>
    </Popover>
  );
}

/** 告警页的刷新按钮复用同一份轮询数据，避免两个入口各算一套 */
export function AlertRefreshButton({
  loading,
  onRefresh,
}: {
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <Button
      type="default"
      className="adm-btn"
      icon={<RefreshCw size={14} />}
      loading={loading}
      onClick={onRefresh}
    >
      刷新
    </Button>
  );
}
