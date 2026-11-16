import { Panel, ToneBadge } from './components';
import { EmailEvents } from './EmailEvents';
import type { EmailRuntimeState } from './types';
import type { EmailConfigState } from './useEmailConfig';

/**
 * 「业务用途」分区。
 *
 * 只有一处真开关（每个事件一个），没有「组开关」——分组只是视觉归类，多一层
 * 组开关会让「组开了但子项全关」变成一个必须解释的中间态。
 */
export function EmailUsageTab({
  config,
  runtime,
  writable,
  onChangeTab,
}: {
  config: EmailConfigState;
  runtime: EmailRuntimeState;
  writable: boolean;
  onChangeTab: (tab: string) => void;
}) {
  return (
    <Panel
      title="业务邮件用途"
      note="按业务场景决定是否发送邮件。用途开关仅影响邮件投递，不改变站内消息、支付、积分、订单或工单处理结果。"
      extra={
        <ToneBadge tone={runtime.enabled ? 'success' : 'warn'}>
          {runtime.enabled ? '总开关已启用' : '总开关已关闭'}
        </ToneBadge>
      }
    >
      <EmailEvents
        masterEnabled={runtime.enabled}
        itemFor={config.itemFor}
        valueFor={config.valueFor}
        disabled={!writable}
        isDirty={config.isDirty}
        onChange={(key, next) => config.setValue(key, next)}
        onOpenDelivery={() => onChangeTab('delivery')}
        onOpenTemplates={() => onChangeTab('templates')}
      />
    </Panel>
  );
}
