import { Panel, SwitchField } from './components';
import { ChannelSelector } from './ChannelSelector';
import { ChannelStateHint } from './ChannelStateHint';
import { EMAIL_KEYS } from './constants';
import { ProviderFields } from './ProviderFields';
import { SettingTextField } from './SettingTextField';
import { TestEmailPanel } from './TestEmailPanel';
import type { EmailRuntimeState } from './types';
import type { EmailChannelState } from './useEmailChannel';
import type { EmailConfigState } from './useEmailConfig';

/**
 * 「投递配置」分区。
 *
 * 左栏按「开关 → 通道 → 发件身份」的配置顺序排列，右栏只放验证手段与结论。
 * 两边分工固定：左边是用户要改的东西，右边是他改完需要确认的东西，混排会让
 * 「配置状态」看起来也像一个可编辑区块。
 */
export function EmailDeliveryTab({
  config,
  channelState,
  runtime,
  writable,
  canInspectChannel,
}: {
  config: EmailConfigState;
  channelState: EmailChannelState;
  runtime: EmailRuntimeState;
  writable: boolean;
  canInspectChannel: boolean;
}) {
  return (
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
              checked={runtime.enabled}
              disabled={!writable}
              onChange={(next) => config.setValue(EMAIL_KEYS.enabled, next)}
            />
          </div>
        </Panel>

        <Panel
          title="投递通道"
          note="选择邮件发送方式。使用真实通道前，请完整填写凭据并完成测试发信；配置不完整时，系统不会将邮件视为已发送。"
        >
          <ChannelSelector
            value={runtime.provider}
            disabled={!writable}
            onChange={(next) => config.setValue(EMAIL_KEYS.provider, next)}
          />
          <ProviderFields
            provider={runtime.provider}
            itemFor={config.itemFor}
            valueFor={config.valueFor}
            disabled={!writable}
            clearPending={config.clearPending}
            onChange={config.setValue}
            onClear={config.requestClear}
            onUndoClear={config.undoClear}
          />
          <div className="mt-4 border-t border-border pt-3">
            <ChannelStateHint
              channel={channelState.channel}
              loading={channelState.loading}
              error={channelState.error}
              canInspect={canInspectChannel}
              onRefresh={() => void channelState.reload()}
            />
          </div>
        </Panel>

        <Panel
          title="发件身份"
          note="设置用户收件箱中显示的发件地址与发件人名称。请使用已完成验证或服务商审核的地址。"
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {config.itemFor(EMAIL_KEYS.from) ? (
              <SettingTextField
                item={config.itemFor(EMAIL_KEYS.from)!}
                value={config.valueFor(EMAIL_KEYS.from)}
                disabled={!writable}
                onChange={(next) => config.setValue(EMAIL_KEYS.from, next)}
              />
            ) : null}
            {config.itemFor(EMAIL_KEYS.fromAlias) ? (
              <SettingTextField
                item={config.itemFor(EMAIL_KEYS.fromAlias)!}
                value={config.valueFor(EMAIL_KEYS.fromAlias)}
                disabled={!writable}
                onChange={(next) => config.setValue(EMAIL_KEYS.fromAlias, next)}
              />
            ) : null}
          </div>
        </Panel>
      </div>

      <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-4">
        <TestEmailPanel
          canSend={canInspectChannel}
          channel={channelState.channel}
          testing={channelState.testing}
          result={channelState.testResult}
          onSend={(to) => void channelState.sendTest(to)}
        />

        <Panel title="配置状态" note="保存前核对通道配置与邮件发送效果，避免误判。">
          <dl className="flex flex-col gap-3 text-[12px]">
            <StatusLine
              label="通道配置"
              value={runtime.providerState.message}
              tone={runtime.providerState.ready === false ? 'warn' : 'neutral'}
            />
            <StatusLine
              label="邮件总开关"
              value={
                runtime.enabled
                  ? '已启用，邮件将按各业务用途开关发送'
                  : '已关闭，验证码、找回密码与业务邮件均暂停发送'
              }
              tone={runtime.enabled ? 'success' : 'warn'}
            />
            <StatusLine
              label="安全邮件"
              value={runtime.enabled ? '验证码与找回密码可发送' : '验证码与找回密码暂停发送'}
              tone={runtime.enabled ? 'success' : 'warn'}
            />
            <StatusLine
              label="已启用用途"
              value={`${runtime.enabledEventCount} / ${runtime.eventKeys.length} 类`}
              tone={runtime.enabledEventCount > 0 ? 'success' : 'neutral'}
            />
          </dl>
        </Panel>
      </aside>
    </div>
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
