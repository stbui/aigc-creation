import { Button } from '../../admin-ui/components/ui/button';
import {
  AlertOctagon,
  AlertTriangle,
  Info,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import type { AdminAlertSeverity } from '../../types/api';

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
 * shadcn `Button` 没有 `loading`，用「禁用 + 改文案」表达同一件事 ——
 * 禁用态已经自带 50% 透明度，不必再叠一个 spinner。
 */
export function AlertRefreshButton({
  loading,
  onRefresh,
}: {
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <Button variant="secondary" size="sm" disabled={loading} onClick={onRefresh}>
      <RefreshCw className="size-4" aria-hidden />
      {loading ? '刷新中…' : '刷新'}
    </Button>
  );
}
