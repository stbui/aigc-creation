import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileText, ListChecks, Send, Settings2 } from 'lucide-react';

import {
  ActionButton,
  AdminTabs,
  AdminPage,
  EmptyState,
  ListError,
  Notice,
  PageSkeleton,
  Panel,
  SaveBar,
  SkeletonPanel,
  StaleError,
  SwitchField,
  TabsContent,
  ToneBadge,
} from '~/admin-ui/primitives';
import { adminNotificationsApi, adminSettingsApi } from '../../../lib/api';
import type {
  AdminSettingValue,
  DeliveryChannelStatus,
  EmailTestResult,
} from '../../../types/api';
import { useAdmin, useToast, useUnsavedGuard, useAdminResource } from './hooks';
import {
  ALL_EMAIL_KEYS,
  EMAIL_KEYS,
  EVENT_GROUPS,
  emailErrorText,
  emailSettingItems,
  isEmailProvider,
  providerConfigState,
  type EmailProvider,
  type EmailSettingItem,
} from './constants';
import {
  ChannelSelector,
  ChannelStateHint,
  EmailEvents,
  EmailOverview,
  TestEmailPanel,
} from './components';
import { ProviderFields, SettingTextField } from './setting-fields';
import { EmailTemplatesPanel } from './email-templates';

/** 同值比较只服务草稿去重；配置值类型由后端 SETTING_DEFS 固定。 */
function sameSettingValue(a: unknown, b: unknown): boolean {
  return a === b;
}

type EmailPageTab = 'delivery' | 'usage' | 'templates';

function emailPageTab(value: string | null): EmailPageTab {
  return value === 'usage' || value === 'templates' ? value : 'delivery';
}

/**
 * 独立邮箱配置页。
 *
 * 邮箱不是普通系统参数：它包含投递通道选择、凭据、发件身份、业务事件开关与
 * 真实发信验证，运营需要围绕一条“配置 → 验证 → 使用”的链路工作。因此这里不
 * 复用系统设置的分组工作台，而是按邮件业务单独组织页面。
 *
 * 数据仍写入统一 settings API，确保发信服务与注册、支付、工单等业务链路读取
 * 到同一份运行时配置；页面只提交 `email.*` 键，不触碰其他系统设置。
 */
export function AdminEmailPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const { can } = useAdmin();
  const writable = can('setting.write');
  const canInspectChannel = can('message.write');

  const activeTab = emailPageTab(searchParams.get('tab'));

  const changeTab = (next: string) => {
    const tab = emailPageTab(next);
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (tab === 'delivery') params.delete('tab');
        else params.set('tab', tab);
        return params;
      },
      { replace: true },
    );
  };

  const { data: settings, loading, error, reload } = useAdminResource(() =>
    adminSettingsApi.read(),
  );
  const items = useMemo(() => emailSettingItems(settings), [settings]);
  const itemMap = useMemo(
    () => new Map(items.map((item) => [item.key, item])),
    [items],
  );

  const [draft, setDraft] = useState<Record<string, AdminSettingValue>>({});
  const [clears, setClears] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const [channel, setChannel] = useState<DeliveryChannelStatus | null>(null);
  const [channelLoading, setChannelLoading] = useState(canInspectChannel);
  const [channelError, setChannelError] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<EmailTestResult | null>(null);

  const dirtyCount = Object.keys(draft).length + clears.size;
  useUnsavedGuard(dirtyCount > 0);

  const reloadChannels = useCallback(async () => {
    if (!canInspectChannel) {
      setChannel(null);
      setChannelLoading(false);
      setChannelError(false);
      return;
    }
    setChannelLoading(true);
    try {
      const next = await adminNotificationsApi.channels();
      setChannel(next.email);
      setChannelError(false);
    } catch {
      setChannel(null);
      setChannelError(true);
    } finally {
      setChannelLoading(false);
    }
  }, [canInspectChannel]);

  useEffect(() => {
    void reloadChannels();
  }, [reloadChannels]);

  const itemFor = (key: string): EmailSettingItem | undefined => itemMap.get(key);

  const valueFor = (key: string): unknown => {
    if (Object.prototype.hasOwnProperty.call(draft, key)) return draft[key];
    return itemFor(key)?.value ?? null;
  };

  const configuredFor = (key: string): boolean => {
    const item = itemFor(key);
    if (!item) return false;
    if (Object.prototype.hasOwnProperty.call(draft, key)) {
      return String(draft[key] ?? '').trim().length > 0;
    }
    return Boolean(item.hasSecret || item.overridden);
  };

  const setValue = (key: string, next: AdminSettingValue) => {
    const item = itemFor(key);
    setDraft((current) => {
      const updated = { ...current };
      if (item?.sensitive && String(next ?? '') === '') {
        delete updated[key];
      } else if (sameSettingValue(next, item?.value ?? null)) {
        delete updated[key];
      } else {
        updated[key] = next;
      }
      return updated;
    });
    setClears((current) => {
      if (!current.has(key)) return current;
      const updated = new Set(current);
      updated.delete(key);
      return updated;
    });
  };

  const requestClear = (key: string) => {
    setDraft((current) => {
      const updated = { ...current };
      delete updated[key];
      return updated;
    });
    setClears((current) => new Set(current).add(key));
  };

  const undoClear = (key: string) => {
    setClears((current) => {
      if (!current.has(key)) return current;
      const updated = new Set(current);
      updated.delete(key);
      return updated;
    });
  };

  const discard = () => {
    setDraft({});
    setClears(new Set());
  };

  const save = async () => {
    setSaving(true);
    try {
      const changes = Object.fromEntries(
        Object.entries(draft).filter(([key]) => ALL_EMAIL_KEYS.has(key) && !clears.has(key)),
      );
      const clearKeys = [...clears].filter((key) => ALL_EMAIL_KEYS.has(key));
      const result = await adminSettingsApi.update({ settings: changes, clears: clearKeys });
      setDraft({});
      setClears(new Set());
      await reload();
      await reloadChannels();
      toast.success(
        '邮箱配置已保存',
        `${result.updated.length + result.cleared.length} 项变更将在后续邮件中生效。`,
      );
    } catch (cause) {
      toast.error(
        '邮箱配置保存失败',
        cause instanceof Error ? cause.message : '请检查邮箱配置后重试。',
      );
    } finally {
      setSaving(false);
    }
  };

  const sendTestEmail = async (to: string) => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await adminNotificationsApi.testEmail(to);
      setTestResult(result);
      if (result.ok) {
        if (result.delivered) {
          toast.success(
            '测试邮件已提交至邮件服务商',
            '请检查收件箱与垃圾邮件目录；服务商受理不代表最终送达。',
          );
        } else {
          toast.warning('测试邮件已记录在本地', '当前通道不会实际发送邮件。');
        }
      } else {
        toast.error('测试邮件发送失败', emailErrorText(result.error));
      }
    } catch (cause) {
      toast.error(
        '测试邮件发送失败',
        cause instanceof Error ? cause.message : '请检查通道配置后重试。',
      );
    } finally {
      setTesting(false);
    }
  };

  if (loading && !settings) {
    return (
      <PageSkeleton
        title="邮箱配置"
        description={
          writable
            ? '正在读取邮件投递通道、发件身份与业务邮件配置'
            : '正在读取邮箱配置与通道状态'
        }
        body={
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <SkeletonPanel rows={4} className="mb-4" />
              <SkeletonPanel rows={7} className="mb-4" />
              <SkeletonPanel rows={8} className="mb-0" />
            </div>
            <SkeletonPanel rows={6} className="mb-0" />
          </div>
        }
      />
    );
  }
  if (error && !settings) return <ListError error={error} onRetry={() => void reload()} />;
  if (!settings) return <EmptyState title="暂时无法读取邮箱配置" />;

  const providerValue = valueFor(EMAIL_KEYS.provider);
  const provider: EmailProvider = isEmailProvider(providerValue) ? providerValue : 'env';
  const enabled = Boolean(valueFor(EMAIL_KEYS.enabled));
  const from = String(valueFor(EMAIL_KEYS.from) ?? '').trim();
  const alias = String(valueFor(EMAIL_KEYS.fromAlias) ?? '').trim();
  const providerState = providerConfigState(provider, valueFor, configuredFor);
  const hasEmailItems = items.length > 0;
  const eventKeys = EVENT_GROUPS.flatMap((group) => group.items.map((item) => item.key));
  const enabledEventCount = eventKeys.filter((key) => Boolean(valueFor(key))).length;
  const tabs = [
    {
      value: 'delivery',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <Settings2 className="size-3.5" aria-hidden />
          投递配置
        </span>
      ),
    },
    {
      value: 'usage',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <ListChecks className="size-3.5" aria-hidden />
          业务用途
          <span className="rounded-full bg-muted px-1.5 text-[11px] leading-5 text-muted-foreground tabular-nums">
            {enabledEventCount}/{eventKeys.length}
          </span>
        </span>
      ),
    },
    {
      value: 'templates',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <FileText className="size-3.5" aria-hidden />
          邮件模板
        </span>
      ),
    },
  ];

  return (
    <AdminPage
      title="邮箱配置"
      description={
        writable
          ? '统一管理邮件投递通道、发件身份、业务邮件通知与发送模板。保存后仅影响后续邮件；正式启用前建议先完成测试发信。'
          : '当前账号仅可查看邮箱配置和通道状态，无修改权限。'
      }
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canInspectChannel ? (
            <ActionButton
              variant="ghost"
              size="sm"
              disabled={channelLoading || testing}
              onClick={() => void reloadChannels()}
            >
              刷新状态
            </ActionButton>
          ) : null}
          {can('message.write') ? (
            <ActionButton
              variant="outline"
              size="sm"
              icon={Send}
              onClick={() => navigate('/admin/notifications')}
            >
              发送活动消息
            </ActionButton>
          ) : null}
          <ToneBadge tone={dirtyCount > 0 ? 'warn' : writable ? 'success' : 'neutral'}>
            {dirtyCount > 0 ? `${dirtyCount} 项未保存` : writable ? '无未保存修改' : '仅查看'}
          </ToneBadge>
        </div>
      }
    >
      {error && <StaleError error={error} onRetry={() => void reload()} />}
      {!writable && (
        <Notice tone="locked" title="仅查看模式" className="mb-4">
          当前账号仅可查看邮箱配置和通道状态，无法修改或保存配置。如需调整，请联系具备系统设置管理权限的管理员。
        </Notice>
      )}

      {hasEmailItems ? (
        <>
          <EmailOverview
            enabled={enabled}
            provider={provider}
            from={from}
            alias={alias}
            configReady={providerState.ready}
            configMessage={providerState.message}
            channel={channel}
            channelLoading={channelLoading}
            channelError={channelError}
            canInspectChannel={canInspectChannel}
          />

          <AdminTabs
            value={activeTab}
            onValueChange={changeTab}
            items={tabs}
            ariaLabel="邮箱配置分区"
            className="gap-4"
          >
            <TabsContent value="delivery" className="m-0">
              <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="min-w-0">
                  <Panel
                    title="邮件通知"
                    note="统一控制业务邮件与安全邮件的实际投递。关闭后站内消息、订单、积分和工单处理均不受影响。"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="m-0 text-[13px] font-medium text-foreground">启用邮件通知</p>
                        <p className="m-0 mt-0.5 text-[12px] leading-5 text-muted-foreground">
                          开启后，系统按“业务用途”中的开关投递邮件；关闭后，验证码、找回密码及全部业务邮件暂停发送。
                        </p>
                      </div>
                      <SwitchField
                        ariaLabel="启用邮件通知"
                        checked={enabled}
                        disabled={!writable}
                        onChange={(next) => setValue(EMAIL_KEYS.enabled, next)}
                      />
                    </div>
                  </Panel>

                  <Panel
                    title="投递通道"
                    note="选择邮件发送方式。使用真实通道前，请完整填写凭据并完成测试发信；配置不完整时，系统不会将邮件视为已发送。"
                  >
                    <ChannelSelector
                      value={provider}
                      disabled={!writable}
                      onChange={(next) => setValue(EMAIL_KEYS.provider, next)}
                    />
                    <ProviderFields
                      provider={provider}
                      itemFor={itemFor}
                      valueFor={valueFor}
                      disabled={!writable}
                      clearPending={(key) => clears.has(key)}
                      onChange={setValue}
                      onClear={requestClear}
                      onUndoClear={undoClear}
                    />
                    <div className="mt-4 border-t border-border pt-3">
                      <ChannelStateHint
                        channel={channel}
                        loading={channelLoading}
                        error={channelError}
                        canInspect={canInspectChannel}
                        onRefresh={() => void reloadChannels()}
                      />
                    </div>
                  </Panel>

                  <Panel
                    title="发件身份"
                    note="设置用户收件箱中显示的发件地址与发件人名称。请使用已完成验证或服务商审核的地址。"
                  >
                    <div className="grid gap-4 lg:grid-cols-2">
                      {itemFor(EMAIL_KEYS.from) ? (
                        <SettingTextField
                          item={itemFor(EMAIL_KEYS.from)!}
                          value={valueFor(EMAIL_KEYS.from)}
                          disabled={!writable}
                          onChange={(next) => setValue(EMAIL_KEYS.from, next)}
                        />
                      ) : null}
                      {itemFor(EMAIL_KEYS.fromAlias) ? (
                        <SettingTextField
                          item={itemFor(EMAIL_KEYS.fromAlias)!}
                          value={valueFor(EMAIL_KEYS.fromAlias)}
                          disabled={!writable}
                          onChange={(next) => setValue(EMAIL_KEYS.fromAlias, next)}
                        />
                      ) : null}
                    </div>
                  </Panel>
                </div>

                <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-4">
                  <TestEmailPanel
                    canSend={canInspectChannel}
                    channel={channel}
                    testing={testing}
                    result={testResult}
                    onSend={(to) => void sendTestEmail(to)}
                  />

                  <Panel title="配置状态" note="保存前核对通道配置与邮件发送效果，避免误判。">
                    <dl className="flex flex-col gap-3 text-[12px]">
                      <StatusLine
                        label="通道配置"
                        value={providerState.message}
                        tone={providerState.ready === false ? 'warn' : 'neutral'}
                      />
                      <StatusLine
                        label="邮件总开关"
                        value={
                          enabled
                            ? '已启用，邮件将按各业务用途开关发送'
                            : '已关闭，验证码、找回密码与业务邮件均暂停发送'
                        }
                        tone={enabled ? 'success' : 'warn'}
                      />
                      <StatusLine
                        label="安全邮件"
                        value={enabled ? '验证码与找回密码可发送' : '验证码与找回密码暂停发送'}
                        tone={enabled ? 'success' : 'warn'}
                      />
                      <StatusLine
                        label="已启用用途"
                        value={`${enabledEventCount} / ${eventKeys.length} 类`}
                        tone={enabledEventCount > 0 ? 'success' : 'neutral'}
                      />
                    </dl>
                  </Panel>
                </aside>
              </div>
            </TabsContent>

            <TabsContent value="usage" className="m-0">
              <Panel
                title="业务邮件用途"
                note="按业务场景决定是否发送邮件。用途开关仅影响邮件投递，不改变站内消息、支付、积分、订单或工单处理结果。"
                extra={
                  <ToneBadge tone={enabled ? 'success' : 'warn'}>
                    {enabled ? '总开关已启用' : '总开关已关闭'}
                  </ToneBadge>
                }
              >
                <EmailEvents
                  masterEnabled={enabled}
                  itemFor={itemFor}
                  valueFor={valueFor}
                  disabled={!writable}
                  isDirty={(key) =>
                    Object.prototype.hasOwnProperty.call(draft, key) || clears.has(key)
                  }
                  onChange={(key, next) => setValue(key, next)}
                  onOpenDelivery={() => changeTab('delivery')}
                  onOpenTemplates={() => changeTab('templates')}
                />
              </Panel>
            </TabsContent>

            <TabsContent value="templates" className="m-0">
              {dirtyCount > 0 ? (
                <Notice tone="warn" title={`投递配置有 ${dirtyCount} 项修改未保存`} className="mb-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span>邮件模板保存后即时生效；投递配置需返回对应分区保存，否则本次修改不会生效。</span>
                    <ActionButton
                      variant="outline"
                      size="xs"
                      onClick={() => changeTab('delivery')}
                    >
                      返回投递配置
                    </ActionButton>
                  </div>
                </Notice>
              ) : null}
              <EmailTemplatesPanel canManage={canInspectChannel} />
            </TabsContent>
          </AdminTabs>

          {activeTab !== 'templates' ? (
            <SaveBar>
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[13px] font-medium text-foreground">
                  {dirtyCount > 0 ? `有 ${dirtyCount} 项修改未保存` : '所有配置均已保存'}
                </p>
                <p className="m-0 mt-0.5 text-[12px] text-muted-foreground">
                  {dirtyCount > 0
                    ? '保存后仅影响后续邮件；正在发送的邮件不会变更。'
                    : '敏感配置仅显示保存状态，不会在页面回显明文。'}
                </p>
              </div>
              <ActionButton
                variant="outline"
                size="sm"
                disabled={!writable || dirtyCount === 0 || saving}
                onClick={discard}
              >
                放弃修改
              </ActionButton>
              <ActionButton
                variant="default"
                size="sm"
                disabled={!writable || dirtyCount === 0 || saving}
                onClick={() => void save()}
              >
                {saving ? '保存中…' : '保存配置'}
              </ActionButton>
            </SaveBar>
          ) : null}
        </>
      ) : (
        <EmptyState
          title="暂时无法读取邮箱配置"
          description="未获取到邮箱配置项，请刷新页面后重试。如问题持续，请联系系统管理员。"
          action={<ActionButton onClick={() => void reload()}>重新加载</ActionButton>}
        />
      )}
    </AdminPage>
  );
}

function StatusLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'success' | 'warn' | 'neutral';
}) {
  const dot =
    tone === 'success' ? 'bg-success-text' : tone === 'warn' ? 'bg-warn-text' : 'bg-muted-foreground';
  return (
    <div className="flex items-start gap-2">
      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      <dt className="w-[68px] shrink-0 text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 flex-1 text-foreground">{value}</dd>
    </div>
  );
}
