import { Card, CardContent, ToneBadge } from './components';
import type { DeliveryChannelStatus } from './types';
import { deliveryProviderLabel, providerMeta } from './utils';

/**
 * 顶部运行概览。
 *
 * 一次给出四个答案：总开关是否打开、发件身份是谁、配置齐不齐、现在到底能不能
 * 真发。第四项必须来自运行状态而不是配置草稿 —— 配置写对了但通道未生效，是
 * 运营最容易误判成「已经能发」的情况。
 */
export function EmailOverview({
  enabled,
  provider,
  from,
  alias,
  configReady,
  configMessage,
  channel,
  channelLoading,
  channelError,
  canInspectChannel,
}: {
  enabled: boolean;
  provider: string;
  from: string;
  alias: string;
  configReady: boolean | null;
  configMessage: string;
  channel: DeliveryChannelStatus | null;
  channelLoading: boolean;
  channelError: boolean;
  canInspectChannel: boolean;
}) {
  const meta = providerMeta(provider);
  const ProviderIcon = meta.icon;

  let runtimeBadge: string;
  let runtimeTone: 'success' | 'warn' | 'danger' | 'neutral' = 'neutral';
  let runtimeNote = '';
  if (!canInspectChannel) {
    runtimeBadge = '权限不足';
    runtimeNote = '当前账号无测试发信权限，无法查看实际投递状态。';
  } else if (channelLoading) {
    runtimeBadge = '确认中';
    runtimeNote = '正在确认当前生效的邮件通道。';
  } else if (channelError || !channel) {
    runtimeBadge = '读取失败';
    runtimeTone = 'danger';
    runtimeNote = '暂时无法确认邮件通道状态。请刷新重试；在此之前，请勿将“发送成功”视为用户已收到。';
  } else if (channel.enabled === false) {
    runtimeBadge = '已停止';
    runtimeTone = 'neutral';
    runtimeNote = '邮件通知已关闭。验证码、找回密码及业务邮件将暂停发送，站内消息不受影响。';
  } else if (!channel.configured) {
    runtimeBadge = '配置不完整';
    runtimeTone = 'danger';
    runtimeNote = '当前通道缺少必要配置，邮件不会实际发送。请补全配置并保存后重试。';
  } else if (channel.delivers) {
    runtimeBadge = '可实际发送';
    runtimeTone = 'success';
    runtimeNote = `邮件将通过${deliveryProviderLabel(channel.provider)}发送。发送成功表示服务商已受理，不代表用户最终收件。`;
  } else {
    runtimeBadge = '仅本地记录';
    runtimeTone = 'warn';
    runtimeNote = '当前仅记录邮件内容，不会送达用户收件箱。';
  }

  const configBadge =
    configReady === null ? '由部署环境决定' : configReady ? '配置完整' : '待补充';
  const configTone: 'neutral' | 'success' | 'warn' =
    configReady === null ? 'neutral' : configReady ? 'success' : 'warn';

  return (
    <Card
      data-testid="email-overview"
      className="mb-4 gap-0 overflow-hidden rounded-xl border-border bg-card py-0"
    >
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center gap-3 bg-gradient-to-r from-accent/70 via-card to-card px-5 py-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-radar-ink-100 text-radar-ink-950">
            <ProviderIcon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 text-sm font-semibold text-foreground">邮件投递概览</h2>
              <ToneBadge tone={enabled ? 'success' : 'neutral'}>
                {enabled ? '邮件通知已启用' : '邮件通知已关闭'}
              </ToneBadge>
              <ToneBadge tone={runtimeTone}>{runtimeBadge}</ToneBadge>
            </div>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              {runtimeNote || configMessage}
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/80 px-3 py-2 text-right">
            <p className="text-xs font-medium tracking-wide text-muted-foreground">当前选择</p>
            <p className="mt-0.5 text-sm font-semibold text-foreground">{meta.label}</p>
          </div>
        </div>

        <dl className="grid grid-cols-2 border-t border-border lg:grid-cols-4">
          <OverviewCell label="邮件总开关" value={enabled ? '已启用' : '已停用'} />
          <OverviewCell
            label="发件身份"
            value={from ? alias ? `${alias} <${from}>` : from : '尚未设置发件地址'}
            mono={Boolean(from)}
          />
          <OverviewCell label="通道配置" value={configBadge} tone={configTone} />
          <OverviewCell
            label="发送方式"
            value={runtimeBadge}
            tone={runtimeTone}
          />
        </dl>
      </CardContent>
    </Card>
  );
}

function OverviewCell({
  label,
  value,
  mono = false,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'success' | 'warn' | 'danger' | 'neutral';
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success-text'
      : tone === 'warn'
        ? 'text-warn-text'
        : tone === 'danger'
          ? 'text-danger-text'
          : 'text-foreground';
  return (
    <div className="min-w-0 border-r border-border px-4 py-3 last:border-r-0 even:border-r-0 lg:even:border-r lg:last:border-r-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd
        className={`mt-1 truncate text-[13px] font-semibold ${toneClass} ${mono ? 'font-mono' : ''}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
