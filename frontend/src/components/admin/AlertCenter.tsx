import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../admin-ui/shadcn/kit';
import {
  AlertOctagon,
  AlertTriangle,
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

/**
 * 告警页的刷新按钮复用同一份轮询数据，避免两个入口各算一套。
 *
 * 用 BoardUI 的 `Button`（而非 antd 的 `type="default"` + `loading`）：
 * 它渲染在 BoardUI 页头的操作区里，混用两套按钮会让同一行里出现两种高度与圆角。
 * vendor 的 Button 没有 `loading`，用「禁用 + 改文案」表达同一件事。
 */
export function AlertRefreshButton({
  loading,
  onRefresh,
}: {
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <Button
      variant="secondary"
      size="small"
      leadingIcon={RefreshCw}
      disabled={loading}
      onClick={onRefresh}
    >
      {loading ? '刷新中…' : '刷新'}
    </Button>
  );
}
