import { useId, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Mail,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';

import {
  ActionButton,
  Card,
  CardContent,
  FormField,
  MiniStat,
  Notice,
  Panel,
  SwitchField,
  TextField,
  ToneBadge,
} from '~/admin-ui/primitives';
import type { DeliveryChannelStatus, EmailTestResult } from '../../../types/api';
import {
  EVENT_GROUPS,
  PROVIDERS,
  deliveryProviderLabel,
  emailErrorText,
  emailFieldCopy,
  providerMeta,
  type EmailProvider,
  type EmailSettingItem,
} from './constants';

type SettingValue = string | number | boolean | null;

function valueText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/* ────────────────────────── 顶部运行概览 ────────────────────────── */

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
      className="mb-4 gap-0 overflow-hidden rounded-xl border-border bg-card py-0 shadow-card"
    >
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center gap-3 bg-gradient-to-r from-accent/70 via-card to-card px-5 py-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
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

/* ────────────────────────── 投递通道选择 ────────────────────────── */

export function ChannelSelector({
  value,
  onChange,
  disabled,
}: {
  value: EmailProvider;
  onChange: (provider: EmailProvider) => void;
  disabled: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="邮件投递通道"
      className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
    >
      {PROVIDERS.map((provider) => {
        const Icon = provider.icon;
        const selected = provider.value === value;
        return (
          <button
            key={provider.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(provider.value)}
            className={[
              'group relative flex min-h-[112px] flex-col items-start rounded-lg border p-3 text-left transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60',
              selected
                ? 'border-brand bg-accent/60 shadow-sm'
                : 'border-border bg-background hover:border-brand/40 hover:bg-muted/30',
            ].join(' ')}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span
                className={[
                  'flex size-8 items-center justify-center rounded-lg',
                  selected ? 'bg-brand text-white' : 'bg-muted text-muted-foreground',
                ].join(' ')}
              >
                <Icon className="size-4" aria-hidden />
              </span>
              {selected ? (
                <span className="flex size-5 items-center justify-center rounded-full bg-brand text-white">
                  <Check className="size-3" aria-hidden />
                </span>
              ) : (
                <span className="text-xs font-semibold tracking-wider text-muted-foreground">
                  {provider.shortLabel}
                </span>
              )}
            </span>
            <span className="mt-2 text-[13px] font-semibold text-foreground">{provider.label}</span>
            <span className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
              {provider.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ────────────────────────── 业务事件 ────────────────────────── */

export function EmailEvents({
  masterEnabled,
  itemFor,
  valueFor,
  disabled,
  isDirty,
  onChange,
  onOpenDelivery,
  onOpenTemplates,
}: {
  masterEnabled: boolean;
  itemFor: (key: string) => EmailSettingItem | undefined;
  valueFor: (key: string) => unknown;
  disabled: boolean;
  isDirty: (key: string) => boolean;
  onChange: (key: string, value: boolean) => void;
  onOpenDelivery: () => void;
  onOpenTemplates: () => void;
}) {
  const eventKeys = EVENT_GROUPS.flatMap((group) => group.items.map((item) => item.key));
  const enabledCount = eventKeys.filter((key) => Boolean(valueFor(key))).length;
  const dirtyCount = eventKeys.filter((key) => isDirty(key)).length;

  return (
    <div className="flex flex-col gap-3">
      {!masterEnabled ? (
        <Notice tone="warn" title="邮件总开关已关闭" className="mb-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>以下用途设置会保留，但不会实际投递邮件。启用邮件总开关并保存后，已启用的用途才会生效。</span>
            <ActionButton variant="outline" size="xs" onClick={onOpenDelivery}>
              前往投递配置
            </ActionButton>
          </div>
        </Notice>
      ) : null}

      <dl className="grid grid-cols-2 gap-0 divide-y divide-border rounded-lg border border-border bg-muted/20 px-4 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <MiniStat label="可配置业务用途" value={`${eventKeys.length} 类`} />
        <MiniStat
          label="已启用用途"
          value={`${enabledCount} / ${eventKeys.length}`}
          tone={enabledCount > 0 ? 'success' : 'muted'}
        />
        <MiniStat label="安全邮件" value="2 类" />
        <MiniStat
          label="用途开关待保存"
          value={dirtyCount > 0 ? `${dirtyCount} 项` : '无变更'}
          tone={dirtyCount > 0 ? 'warn' : 'muted'}
        />
      </dl>

      <div className="grid gap-3 xl:grid-cols-2">
        {EVENT_GROUPS.map((group) => {
          const GroupIcon = group.icon;
          const groupEnabledCount = group.items.filter(({ key }) => Boolean(valueFor(key))).length;
          return (
            <section
              key={group.title}
              className="overflow-hidden rounded-lg border border-border bg-background"
              aria-labelledby={`email-event-${group.title}`}
            >
              <div className="flex items-start gap-3 border-b border-border bg-muted/20 px-4 py-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <GroupIcon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3
                      id={`email-event-${group.title}`}
                      className="m-0 text-[13px] font-semibold text-foreground"
                    >
                      {group.title}
                    </h3>
                    <ToneBadge tone={groupEnabledCount > 0 ? 'success' : 'neutral'}>
                      {groupEnabledCount > 0 ? `${groupEnabledCount} 项启用` : '全部停用'}
                    </ToneBadge>
                  </div>
                  <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{group.note}</p>
                </div>
              </div>
              <div className="flex flex-col divide-y divide-border px-4">
                {group.items.map(({ key, icon: Icon }) => {
                  const item = itemFor(key);
                  if (!item) return null;
                  const copy = emailFieldCopy(item.key, item);
                  const eventEnabled = Boolean(valueFor(key));
                  return (
                    <div key={key} className="flex items-start gap-3 py-3 first:pt-3 last:pb-3">
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Icon className="size-3.5" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[12px] font-medium text-foreground">{copy.label}</span>
                          <ToneBadge tone={eventEnabled && masterEnabled ? 'success' : 'neutral'}>
                            {!masterEnabled
                              ? '总开关关闭'
                              : eventEnabled
                                ? '发送中'
                                : '已停用'}
                          </ToneBadge>
                          {isDirty(key) && <ToneBadge tone="warn">有修改</ToneBadge>}
                        </div>
                        <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                          {copy.hint}
                        </p>
                      </div>
                      <SwitchField
                        ariaLabel={copy.label}
                        checked={eventEnabled}
                        disabled={disabled}
                        onChange={(next) => onChange(key, next)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <p className="m-0 text-[12px] leading-5 text-muted-foreground">
          注册验证码与找回密码属于安全邮件，仅受邮件总开关控制；业务模板内容可在“邮件模板”中单独维护。
        </p>
        <ActionButton variant="outline" size="sm" onClick={onOpenTemplates}>
          管理邮件模板
        </ActionButton>
      </div>
    </div>
  );
}

/* ────────────────────────── 测试发信 ────────────────────────── */

export function TestEmailPanel({
  canSend,
  channel,
  testing,
  result,
  onSend,
}: {
  canSend: boolean;
  channel: DeliveryChannelStatus | null;
  testing: boolean;
  result: EmailTestResult | null;
  onSend: (to: string) => void;
}) {
  const inputId = useId();
  const [to, setTo] = useState('');

  return (
    <Panel
      title="测试发信"
      note="使用当前生效配置发送测试邮件，验证发件地址、访问凭据与邮件服务是否可用。"
    >
      <div className="flex flex-col gap-3">
        {!canSend ? (
          <Notice tone="locked" title="当前账号无测试发信权限" className="mb-0">
            你可以查看和保存配置，但不能发送测试邮件。请联系具备消息通知管理权限的管理员完成验证。
          </Notice>
        ) : channel?.enabled === false ? (
          <Notice tone="warn" title="邮件通知已关闭">
            测试发信也会被拒绝。请先启用邮件通知并保存配置。
          </Notice>
        ) : channel && !channel.delivers ? (
          <Notice tone="warn" title="当前不会实际发送">
            {channel.configured
              ? '当前为本地记录模式，测试邮件不会送达收件箱。'
              : '当前通道配置不完整，测试邮件不会实际发送。请补全配置并保存后重试。'}
          </Notice>
        ) : null}

        <FormField
          label="收件邮箱"
          htmlFor={inputId}
          hint="测试邮件仅用于验证当前邮件发送配置，不会触发业务通知，也不会写入站内消息。"
        >
          <TextField
            id={inputId}
            ariaLabel="测试邮件收件邮箱"
            type="email"
            value={to}
            disabled={!canSend || testing}
            maxLength={200}
            placeholder="you@example.com"
            onChange={setTo}
            onEnter={() => {
              if (canSend && !testing && to.trim()) onSend(to.trim());
            }}
          />
        </FormField>

        <ActionButton
          variant="default"
          icon={Send}
          disabled={!canSend || testing || !to.trim()}
          onClick={() => onSend(to.trim())}
        >
          {testing ? '发送中…' : '发送测试邮件'}
        </ActionButton>

        {result ? (
          <Notice
            tone={result.ok ? (result.delivered ? 'success' : 'warn') : 'danger'}
            title={
              result.ok
                ? result.delivered
                  ? '邮件服务商已受理测试邮件'
                  : '测试邮件仅记录在本地'
                : '测试邮件发送失败'
            }
            className="mb-0"
          >
            <span className="block">
              {result.ok && result.delivered
                ? `投递通道：${deliveryProviderLabel(result.provider)}${result.messageId ? ` · 消息编号：${result.messageId}` : ''}。请检查收件箱与垃圾邮件目录；服务商受理不代表最终送达。`
                : result.ok
                  ? '投递通道：本地记录。测试邮件不会送达收件箱，请切换至可实际发送的通道后重新测试。'
                  : emailErrorText(
                      result.error,
                      `邮件未发送。投递通道：${deliveryProviderLabel(result.provider)}。请检查配置后重试。`,
                    )}
            </span>
          </Notice>
        ) : null}

        <div className="rounded-md bg-muted/40 px-3 py-2 text-[12px] leading-5 text-muted-foreground">
          <p className="m-0 flex items-center gap-1.5 font-medium text-foreground">
            <ShieldCheck className="size-3.5 text-success-text" aria-hidden />
            验证建议
          </p>
          <p className="m-0 mt-0.5">
            若测试失败，请依次检查发件地址审核、域名解析、访问凭据和服务商配额。测试结果不会展示密钥或邮件正文。
          </p>
        </div>
      </div>
    </Panel>
  );
}

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

export function EmailIdentityIcon() {
  return <Mail className="size-4" aria-hidden />;
}
