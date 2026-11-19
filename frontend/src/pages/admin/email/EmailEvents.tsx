import { ActionButton, MiniStat, Notice, SwitchField, ToneBadge } from './components';
import { EVENT_GROUPS } from './constants';
import type { EmailSettingItem } from './types';
import { emailFieldCopy } from './utils';

/**
 * 业务邮件用途开关。
 *
 * 每个用途只控制「这类事件是否发邮件」，不控制事件本身：关掉支付成功邮件，
 * 支付照常完成、积分照常入账。因此总开关关闭时这里不隐藏任何条目，而是明确
 * 标注「总开关关闭」——把开关藏起来会让运营以为该用途已经删了。
 */
export function EmailEvents({
  masterEnabled,
  itemFor,
  valueFor,
  disabled,
  dirty,
  onChange,
  onOpenDelivery,
  onOpenTemplates,
}: {
  masterEnabled: boolean;
  itemFor: (key: string) => EmailSettingItem | undefined;
  valueFor: (key: string) => unknown;
  disabled: boolean;
  dirty: (key: string) => boolean;
  onChange: (key: string, value: boolean) => void;
  onOpenDelivery: () => void;
  onOpenTemplates: () => void;
}) {
  const eventKeys = EVENT_GROUPS.flatMap((group) => group.items.map((item) => item.key));
  const enabledCount = eventKeys.filter((key) => Boolean(valueFor(key))).length;
  const dirtyCount = eventKeys.filter((key) => dirty(key)).length;

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
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-radar-ink-100 text-radar-ink-950">
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
                          {dirty(key) && <ToneBadge tone="warn">有修改</ToneBadge>}
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
