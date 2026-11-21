import { Link } from 'react-router-dom';

import { ActionButton, Notice, Panel, StatusTag } from './components';
import { deliveryProviderLabel } from './utils';
import type { DeliveryChannelStatusMap } from '../../../types/api';

/**
 * 投递通道状态（只读）。
 *
 * 读失败就整块不渲染成「正常」：`channelsError` 时明确显示失败并给出去配置页的
 * 入口，因为「读不到状态」在运营眼里等于「不知道用户会不会收到」。
 */
export function ChannelsPanel({
  channels,
  loading,
  error,
  onReload,
}: {
  channels: DeliveryChannelStatusMap | null;
  loading: boolean;
  error: boolean;
  onReload: () => void;
}) {
  if (loading) {
    return (
      <Panel title="投递通道" note="正在读取当前生效通道…">
        <p className="text-[12px] text-muted-foreground">读取中，请稍候。</p>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel title="投递通道" note="无法确认当前是否真实投递">
        <Notice tone="danger" title="通道状态读取失败" className="mb-0">
          请刷新重试；在状态恢复前，请勿将“发送成功”视为用户已收到。
          <ActionButton asChild variant="ghost" size="xs" className="ml-2">
            <Link to="/admin/email">打开邮箱配置</Link>
          </ActionButton>
        </Notice>
      </Panel>
    );
  }

  if (!channels) return null;

  return (
    <Panel
      title="投递通道"
      note="邮箱配置保存后立即生效；短信通道由部署环境配置决定"
      extra={
        <ActionButton variant="ghost" size="xs" onClick={onReload}>
          刷新状态
        </ActionButton>
      }
    >
      <ul className="flex flex-col gap-2.5">
        {(
          [
            { label: '邮件', channel: 'email' as const, st: channels.email, target: channels.email.from },
            { label: '短信', channel: 'sms' as const, st: channels.sms, target: channels.sms.sign },
          ] as const
        ).map(({ label, channel, st, target }) => (
          <li key={label} className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="w-10 shrink-0 font-medium text-foreground">{label}</span>
            <StatusTag
              status={st.enabled === false ? 'disabled' : st.delivers ? 'active' : 'disabled'}
              label={
                st.enabled === false
                  ? '已关闭'
                  : st.delivers
                    ? `可实际发送 · ${deliveryProviderLabel(st.provider, channel)}`
                    : st.configured
                      ? `本地记录 · ${deliveryProviderLabel(st.provider, channel)}`
                      : '配置不完整'
              }
            />
            {target ? (
              <span className="font-mono text-[12px] text-muted-foreground">{target}</span>
            ) : null}
            {st.enabled !== false && !st.configured ? (
              <span className="text-warn-text">配置不完整，当前不会实际发送</span>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
