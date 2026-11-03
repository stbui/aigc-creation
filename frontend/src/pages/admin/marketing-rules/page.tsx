import { useEffect, useState } from 'react';
import { useAdmin, useUnsavedGuard, useToast, useAdminResource } from './hooks';
import { Plus, Trash2 } from 'lucide-react';
import { marketingApi } from '../../../lib/api';

import { ActionButton, FormField, IconButton, ListError, NumberField, PageHeader, PageSkeleton, Panel, SelectField, StaleError, SwitchField } from '~/admin-ui/primitives';
import type { CheckinRule, InviteRule } from '../../../types/api';

/**
 * 单条全局规则的保存条。
 *
 * 「有未保存修改」必须写在按钮左侧同一行：两块规则共用同一个 `busy`，
 * 保存一区时另一区的按钮同时变灰，用户需要知道哪一块真的改过。
 */
export function RuleActions({
  hint,
  dirty,
  busy,
  onDiscard,
  onSave,
  saveText,
}: {
  hint: string;
  dirty: boolean;
  busy: boolean;
  onDiscard: () => void;
  onSave: () => void;
  saveText: string;
}) {
  return (
    <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
      <span className="mr-auto text-[12px] text-muted-foreground">
        {dirty && <span className="text-warn-text">有未保存修改 · </span>}
        {hint}
      </span>
      {dirty && (
        <ActionButton variant="secondary" size="sm" disabled={busy} onClick={onDiscard}>
          放弃变更
        </ActionButton>
      )}
      <ActionButton variant="default" size="sm" disabled={busy} onClick={onSave}>
        {busy ? '保存中…' : saveText}
      </ActionButton>
    </div>
  );
}

/**
 * 邀请规则 (B-66) 与签到规则 (B-67)。
 *
 * 两者都是单条全局规则, 不需要列表 —— 用表单直接编辑比列表+详情更直接。
 */
export function AdminMarketingRulesPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const writable = can('marketing.write');

  const [invite, setInvite] = useState<InviteRule | null>(null);
  const [checkin, setCheckin] = useState<CheckinRule | null>(null);
  /** 服务端最后一次成功保存的快照，用于判断未保存修改与“放弃变更” */
  const [inviteBase, setInviteBase] = useState<InviteRule | null>(null);
  const [checkinBase, setCheckinBase] = useState<CheckinRule | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * 两条规则是同一次加载: 表单里常在两块之间来回对照(邀请奖励 vs 签到奖励),
   * 分开加载会让其中一块停留在旧值上, 而用户以为看到的是同一时刻的配置。
   */
  const { data, loading, error, reload } = useAdminResource(
    () => Promise.all([marketingApi.inviteRule(), marketingApi.checkinRule()]),
    [],
  );

  /*
   * 草稿依赖 data 而不是 invite/checkin: 后者是本页可编辑的副本,
   * 把同步逻辑挂在自己的 state 上会边打字边被覆盖。
   */
  useEffect(() => {
    if (!data) return;
    setInvite(data[0]);
    setCheckin(data[1]);
    setInviteBase(data[0]);
    setCheckinBase(data[1]);
  }, [data]);

  const inviteDirty = Boolean(
    invite && inviteBase && JSON.stringify(invite) !== JSON.stringify(inviteBase),
  );
  const checkinDirty = Boolean(
    checkin && checkinBase && JSON.stringify(checkin) !== JSON.stringify(checkinBase),
  );
  const dirtyCount = Number(inviteDirty) + Number(checkinDirty);
  useUnsavedGuard(writable && dirtyCount > 0);

  /*
   * 只有完全没有数据时才塌**正文**; 已有草稿时保留表单, 由下方 stale 提示交代刷新失败。
   *
   * 页头照常渲染：加载期间标题与说明就该在位，否则首屏先闪一段没有标题的灰条，
   * 再冒出完整页面 —— 骨架该占住位置，不是把版面清空。
   * 两块面板限宽 760，与真实窄版 `Panel` 同宽。
   */
  if (loading && !data) {
    return (
      <PageSkeleton
        title="邀请与签到"
        description="邀请分销与每日签到的积分规则。保存后立即生效，已发放的积分不受影响。"
        panels={2}
        panelRows={4}
        narrow
      />
    );
  }
  // 重试只重跑本页的两次请求, 不整页刷新 —— reload 会丢掉 C 端的路由参数与滚动位置
  if (error && !data) return <ListError error={error} onRetry={() => void reload()} />;

  const saveInvite = async () => {
    if (!invite) return;
    setBusy(true);
    try {
      const saved = await marketingApi.updateInviteRule(invite);
      setInvite(saved);
      setInviteBase(saved);
      toast.success('邀请规则已保存，立即生效');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveCheckin = async () => {
    if (!checkin) return;
    setBusy(true);
    try {
      const saved = await marketingApi.updateCheckinRule(checkin);
      setCheckin(saved);
      setCheckinBase(saved);
      toast.success('签到规则已保存，立即生效');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="邀请与签到"
        description="邀请分销与每日签到的积分规则。保存后立即生效，已发放的积分不受影响。"
        actions={
          !writable ? (
            <span className="text-[12px] text-muted-foreground">
              当前账号无 marketing.write 权限，仅可查看
            </span>
          ) : undefined
        }
      />

      {error && <StaleError error={error} onRetry={() => void reload()} />}

      {/* 邀请规则 */}
      <Panel narrow title="邀请分销规则" note="奖励在触发条件满足时自动发放">
        {invite && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="邀请人奖励 (积分)">
                <NumberField
                  ariaLabel="邀请人奖励积分"
                  value={invite.inviterCredits}
                  disabled={!writable}
                  onChange={(value) => setInvite({ ...invite, inviterCredits: value ?? 0 })}
                />
              </FormField>
              <FormField label="被邀请人奖励 (积分)">
                <NumberField
                  ariaLabel="被邀请人奖励积分"
                  value={invite.inviteeCredits}
                  disabled={!writable}
                  onChange={(value) => setInvite({ ...invite, inviteeCredits: value ?? 0 })}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-2 items-start gap-4">
              <FormField
                label="发放时机"
                hint="选「注册后」奖励门槛低但易被刷，选「首次支付」更稳妥"
              >
                <SelectField
                  ariaLabel="发放时机"
                  value={invite.triggerOn}
                  disabled={!writable}
                  onChange={(value) =>
                    setInvite({ ...invite, triggerOn: value as 'first_pay' | 'register' })
                  }
                  options={[
                    { value: 'first_pay', label: '被邀请人首次支付后' },
                    { value: 'register', label: '被邀请人注册后' },
                  ]}
                />
              </FormField>
              <div className="pt-6">
                <SwitchField
                  checked={invite.valid}
                  disabled={!writable}
                  onChange={(checked) => setInvite({ ...invite, valid: checked })}
                  label={invite.valid ? '启用邀请奖励' : '停用邀请奖励'}
                />
              </div>
            </div>

            {writable && (
              <RuleActions
                hint={`邀请人得 ${invite.inviterCredits} 分，被邀请人得 ${invite.inviteeCredits} 分`}
                dirty={inviteDirty}
                busy={busy}
                onDiscard={() => setInvite(inviteBase)}
                onSave={() => void saveInvite()}
                saveText="保存邀请规则"
              />
            )}
          </div>
        )}
      </Panel>

      {/* 签到规则 */}
      <Panel narrow title="签到规则" note="连续签到到指定天数可获得额外加成">
        {checkin && (
          <div className="flex flex-col gap-4">
            <FormField label="每日基础积分">
              <NumberField
                ariaLabel="每日基础积分"
                className="w-[180px]"
                value={checkin.baseCredits}
                disabled={!writable}
                onChange={(value) => setCheckin({ ...checkin, baseCredits: value ?? 0 })}
              />
            </FormField>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">连续加成</span>
              <p className="text-[12px] leading-4 text-muted-foreground">
                到达指定连续天数时，额外获得 bonus 积分
              </p>
              <div className="flex flex-col gap-2">
                {checkin.bonusRules.map((b, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">连续</span>
                    <NumberField
                      ariaLabel={`第 ${i + 1} 档连续天数`}
                      className="w-[90px]"
                      min={1}
                      value={b.day}
                      disabled={!writable}
                      onChange={(value) => {
                        const next = [...checkin.bonusRules];
                        next[i] = { ...b, day: value ?? 1 };
                        setCheckin({ ...checkin, bonusRules: next });
                      }}
                    />
                    <span className="text-xs text-muted-foreground">天，加成</span>
                    <NumberField
                      ariaLabel={`第 ${i + 1} 档加成积分`}
                      className="w-[90px]"
                      value={b.bonus}
                      disabled={!writable}
                      onChange={(value) => {
                        const next = [...checkin.bonusRules];
                        next[i] = { ...b, bonus: value ?? 0 };
                        setCheckin({ ...checkin, bonusRules: next });
                      }}
                    />
                    <span className="text-xs text-muted-foreground">积分</span>
                    {writable && (
                      <IconButton
                        icon={Trash2}
                        size="sm"
                        label={`删除第 ${i + 1} 档加成`}
                        className="border-0 bg-transparent text-muted-foreground hover:text-danger-text"
                        onClick={() =>
                          setCheckin({
                            ...checkin,
                            bonusRules: checkin.bonusRules.filter((_, j) => j !== i),
                          })
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
              {writable && (
                <ActionButton
                  variant="secondary"
                  size="sm"
                  icon={Plus}
                  className="mt-1 self-start"
                  onClick={() =>
                    setCheckin({
                      ...checkin,
                      bonusRules: [...checkin.bonusRules, { day: 7, bonus: 10 }],
                    })
                  }
                >
                  添加加成档位
                </ActionButton>
              )}
            </div>

            <SwitchField
              checked={checkin.enabled}
              disabled={!writable}
              onChange={(checked) => setCheckin({ ...checkin, enabled: checked })}
              label={checkin.enabled ? '启用签到' : '停用签到'}
            />

            {writable && (
              <RuleActions
                hint={`基础 ${checkin.baseCredits} 分/天 · ${checkin.bonusRules.length} 个加成档位`}
                dirty={checkinDirty}
                busy={busy}
                onDiscard={() => setCheckin(checkinBase)}
                onSave={() => void saveCheckin()}
                saveText="保存签到规则"
              />
            )}
          </div>
        )}
      </Panel>
    </>
  );
}
