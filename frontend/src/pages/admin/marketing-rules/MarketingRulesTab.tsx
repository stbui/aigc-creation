import { Plus, Trash2 } from 'lucide-react';
import {
  ActionButton,
  FormField,
  IconButton,
  ListError,
  NumberField,
  PageSkeleton,
  Panel,
  SelectField,
  StaleError,
  SwitchField,
} from '~/admin-ui/primitives';
import type { RuleDrafts } from './hooks';

/**
 * 单条全局规则的保存条。
 *
 * 「有未保存修改」必须写在按钮左侧同一行：两块规则共用同一个 `busy`，
 * 保存一区时另一区的按钮同时变灰，用户需要知道哪一块真的改过。
 */
function RuleActions({
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
      <ActionButton
        variant="default"
        size="sm"
        /* 没有改动时保存按钮不可点：可点却什么都不改变，会让人以为「已经保存过」 */
        disabled={busy || !dirty}
        onClick={onSave}
      >
        {busy ? '保存中…' : saveText}
      </ActionButton>
    </div>
  );
}
/**
 * 规则配置标签（`?tab=rules`）：邀请规则 (B-66) 与签到规则 (B-67)。
 *
 * 两者都是单条全局规则, 不需要列表 —— 用表单直接编辑比列表+详情更直接。
 * 需要列表的是**流水**：邀请关系与签到记录在各自的标签里。
 *
 * 草稿状态由页面经 `useRuleDrafts` 传进来：本组件随标签切换卸载，草稿留在
 * 组件内就等于静默丢掉未保存的修改。
 */
export function MarketingRulesTab({
  writable,
  drafts,
}: {
  writable: boolean;
  drafts: RuleDrafts;
}) {
  const {
    invite,
    checkin,
    inviteBase,
    checkinBase,
    setInvite,
    setCheckin,
    inviteDirty,
    checkinDirty,
    busy,
    loaded,
    loading,
    error,
    reload,
    saveInvite,
    saveCheckin,
  } = drafts;

  /*
   * 只有完全没有数据时才塌**正文**; 已有草稿时保留表单, 由下方 stale 提示交代刷新失败。
   *
   * 骨架只占正文：页头是页面级的（`page.tsx`），加载期间标题与说明一直在位。
   * 两块面板限宽 760，与真实窄版 `Panel` 同宽。
   */
  if (loading && !loaded) {
    return <PageSkeleton panels={2} panelRows={4} narrow />;
  }
  // 重试只重跑本板块的两次规则请求, 不整页刷新 —— reload 会丢掉 C 端的路由参数与滚动位置
  if (error && !loaded) return <ListError error={error} onRetry={reload} />;

  return (
    <>
      {error && <StaleError error={error} onRetry={reload} />}

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

            <div className="grid grid-cols-2 gap-4">
              <FormField label="连续签到封顶 (天)" hint="0 表示不封顶">
                <NumberField
                  ariaLabel="连续签到封顶天数"
                  min={0}
                  value={checkin.maxStreak}
                  disabled={!writable}
                  onChange={(value) => setCheckin({ ...checkin, maxStreak: value ?? 0 })}
                />
              </FormField>
              <FormField label="每日积分上限" hint="0 表示不限制">
                <NumberField
                  ariaLabel="每日签到积分上限"
                  min={0}
                  value={checkin.dailyCap}
                  disabled={!writable}
                  onChange={(value) => setCheckin({ ...checkin, dailyCap: value ?? 0 })}
                />
              </FormField>
            </div>

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
                      min={0}
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
                hint={`基础 ${checkin.baseCredits} 分/天 · 连签封顶 ${checkin.maxStreak || '不限'} · 日上限 ${checkin.dailyCap || '不限'} · ${checkin.bonusRules.length} 个加成档位`}
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
