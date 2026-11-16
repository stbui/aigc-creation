import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { ActionButton, Notice } from './components';
import type { DeliveryChannelStatus } from './types';
import { deliveryProviderLabel } from './utils';

/**
 * 通道状态提示条。
 *
 * 四种状态各有明确下一步：无权限（去要权限）、读取中、读取失败（点重试）、
 * 已知状态（看是否真发）。读取失败时不给「刷新状态」以外的操作，避免在状态
 * 未知的情况下继续判断「能不能发」。
 */
export function ChannelStateHint({
  channel,
  loading,
  error,
  canInspect,
  onRefresh,
}: {
  channel: DeliveryChannelStatus | null;
  loading: boolean;
  error: boolean;
  canInspect: boolean;
  onRefresh: () => void;
}) {
  if (!canInspect) {
    return (
      <div className="text-[12px] leading-5 text-muted-foreground">
        当前账号无测试发信权限，无法查看实际投递状态。保存后的配置仍会用于后续邮件。
      </div>
    );
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <RefreshCw className="size-3.5 animate-spin" aria-hidden />
        正在读取当前生效通道…
      </div>
    );
  }
  if (error || !channel) {
    return (
      <Notice tone="danger" title="通道状态读取失败" className="mb-0">
        请重新读取。在状态恢复前，请勿将“发送成功”视为用户已收到。
        <ActionButton variant="ghost" size="xs" className="ml-2" onClick={onRefresh}>
          重新读取
        </ActionButton>
      </Notice>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px] leading-5 text-muted-foreground">
      {channel.delivers ? (
        <CheckCircle2 className="size-3.5 shrink-0 text-success-text" aria-hidden />
      ) : (
        <AlertTriangle className="size-3.5 shrink-0 text-warn-text" aria-hidden />
      )}
      <span>
        当前生效通道：<strong className="font-medium text-foreground">{deliveryProviderLabel(channel.provider)}</strong>
        {channel.delivers
          ? ' · 可实际发送'
          : channel.configured
            ? ' · 不会实际发送'
            : ' · 配置不完整，未实际发送'}
        {channel.from ? ` · ${channel.from}` : ''}
      </span>
      <ActionButton variant="ghost" size="xs" onClick={onRefresh}>
        刷新状态
      </ActionButton>
    </div>
  );
}
