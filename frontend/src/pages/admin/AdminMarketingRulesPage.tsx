import { useEffect, useState } from 'react';
import { App } from 'antd';
import { Gift, Plus, Trash2 } from 'lucide-react';
import { marketingApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { AdminListError, AdminListLoading, ConfirmAction } from '../../components/admin/AdminWidgets';
import { PageHeader, Panel, StatusTag } from '../../components/admin/PageHeader';
import type { CheckinRule, InviteRule } from '../../types/api';

/**
 * 邀请规则 (B-66) 与签到规则 (B-67)。
 *
 * 两者都是单条全局规则, 不需要列表 —— 用表单直接编辑比列表+详情更直接。
 */
export function AdminMarketingRulesPage() {
  const { message } = App.useApp();
  const { can } = useAdmin();
  const writable = can('marketing.write');

  const [invite, setInvite] = useState<InviteRule | null>(null);
  const [checkin, setCheckin] = useState<CheckinRule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<'invite' | 'checkin' | null>(null);

  useEffect(() => {
    Promise.all([marketingApi.inviteRule(), marketingApi.checkinRule()])
      .then(([i, c]) => {
        setInvite(i);
        setCheckin(c);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <AdminListLoading tip="加载营销规则…" />;
  if (error) return <AdminListError error={error} onRetry={() => window.location.reload()} />;

  const saveInvite = async () => {
    if (!invite) return;
    setBusy(true);
    try {
      setInvite(await marketingApi.updateInviteRule(invite));
      setConfirming(null);
      void message.success('邀请规则已保存，立即生效');
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveCheckin = async () => {
    if (!checkin) return;
    setBusy(true);
    try {
      setCheckin(await marketingApi.updateCheckinRule(checkin));
      setConfirming(null);
      void message.success('签到规则已保存，立即生效');
    } catch (e) {
      void message.error((e as Error).message);
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
          !writable ? <span className="adm-cell-sub">当前账号无 marketing.write 权限，仅可查看</span> : undefined
        }
      />

      {/* 邀请规则 */}
      <Panel title="邀请分销规则" note="奖励在触发条件满足时自动发放">
        {invite && (
          <div className="adm-form">
            <div className="adm-form-row">
              <div className="adm-field">
                <label htmlFor="i-inviter">邀请人奖励 (积分)</label>
                <input
                  id="i-inviter"
                  type="number"
                  value={invite.inviterCredits}
                  disabled={!writable}
                  onChange={(e) => setInvite({ ...invite, inviterCredits: Number(e.target.value) })}
                />
              </div>
              <div className="adm-field">
                <label htmlFor="i-invitee">被邀请人奖励 (积分)</label>
                <input
                  id="i-invitee"
                  type="number"
                  value={invite.inviteeCredits}
                  disabled={!writable}
                  onChange={(e) => setInvite({ ...invite, inviteeCredits: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="adm-form-row">
              <div className="adm-field">
                <label htmlFor="i-trigger">发放时机</label>
                <select
                  id="i-trigger"
                  value={invite.triggerOn}
                  disabled={!writable}
                  onChange={(e) =>
                    setInvite({ ...invite, triggerOn: e.target.value as 'first_pay' | 'register' })
                  }
                >
                  <option value="first_pay">被邀请人首次支付后</option>
                  <option value="register">被邀请人注册后</option>
                </select>
                <div className="adm-field-hint">
                  选「注册后」奖励门槛低但易被刷，选「首次支付」更稳妥
                </div>
              </div>
              <div className="adm-field">
                <label className="adm-switch">
                  <input
                    type="checkbox"
                    checked={invite.valid}
                    disabled={!writable}
                    onChange={(e) => setInvite({ ...invite, valid: e.target.checked })}
                  />
                  <span className="adm-switch-track" aria-hidden="true" />
                  <span className="adm-switch-text">启用邀请奖励</span>
                </label>
              </div>
            </div>

            {writable && (
              <div className="adm-action-bar" style={{ position: 'static' }}>
                <span className="adm-action-hint">
                  邀请人得 {invite.inviterCredits} 分，被邀请人得 {invite.inviteeCredits} 分
                </span>
                <button
                  type="button"
                  className="adm-btn is-primary"
                  onClick={() => setConfirming('invite')}
                  disabled={busy}
                >
                  保存邀请规则
                </button>
              </div>
            )}
          </div>
        )}
      </Panel>

      {/* 签到规则 */}
      <Panel title="签到规则" note="连续签到到指定天数可获得额外加成">
        {checkin && (
          <div className="adm-form">
            <div className="adm-field">
              <label htmlFor="c-base">每日基础积分</label>
              <input
                id="c-base"
                type="number"
                value={checkin.baseCredits}
                disabled={!writable}
                onChange={(e) => setCheckin({ ...checkin, baseCredits: Number(e.target.value) })}
              />
            </div>

            <div className="adm-field">
              <label>连续加成</label>
              <div className="adm-field-hint">到达指定连续天数时，额外获得 bonus 积分</div>
              <div className="adm-bonus-list">
                {checkin.bonusRules.map((b, i) => (
                  <div key={i} className="adm-bonus-row">
                    <span className="adm-cell-sub">连续</span>
                    <input
                      type="number"
                      value={b.day}
                      disabled={!writable}
                      onChange={(e) => {
                        const next = [...checkin.bonusRules];
                        next[i] = { ...b, day: Number(e.target.value) };
                        setCheckin({ ...checkin, bonusRules: next });
                      }}
                    />
                    <span className="adm-cell-sub">天，加成</span>
                    <input
                      type="number"
                      value={b.bonus}
                      disabled={!writable}
                      onChange={(e) => {
                        const next = [...checkin.bonusRules];
                        next[i] = { ...b, bonus: Number(e.target.value) };
                        setCheckin({ ...checkin, bonusRules: next });
                      }}
                    />
                    <span className="adm-cell-sub">积分</span>
                    {writable && (
                      <button
                        type="button"
                        className="adm-link is-danger"
                        onClick={() =>
                          setCheckin({
                            ...checkin,
                            bonusRules: checkin.bonusRules.filter((_, j) => j !== i),
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {writable && (
                <button
                  type="button"
                  className="adm-btn"
                  style={{ marginTop: 8 }}
                  onClick={() =>
                    setCheckin({
                      ...checkin,
                      bonusRules: [...checkin.bonusRules, { day: 7, bonus: 10 }],
                    })
                  }
                >
                  <Plus size={13} style={{ marginRight: 4 }} />
                  添加加成档位
                </button>
              )}
            </div>

            <div className="adm-field">
              <label className="adm-switch">
                <input
                  type="checkbox"
                  checked={checkin.enabled}
                  disabled={!writable}
                  onChange={(e) => setCheckin({ ...checkin, enabled: e.target.checked })}
                />
                <span className="adm-switch-track" aria-hidden="true" />
                <span className="adm-switch-text">启用签到</span>
              </label>
            </div>

            {writable && (
              <div className="adm-action-bar" style={{ position: 'static' }}>
                <span className="adm-action-hint">
                  基础 {checkin.baseCredits} 分/天 · {checkin.bonusRules.length} 个加成档位
                </span>
                <button
                  type="button"
                  className="adm-btn is-primary"
                  onClick={() => setConfirming('checkin')}
                  disabled={busy}
                >
                  保存签到规则
                </button>
              </div>
            )}
          </div>
        )}
      </Panel>

      {confirming && (
        <ConfirmAction
          open
          title={confirming === 'invite' ? '保存邀请规则' : '保存签到规则'}
          confirmText="确认保存"
          loading={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={() =>
            confirming === 'invite' ? void saveInvite() : void saveCheckin()
          }
          description={<p>规则保存后立即生效，影响后续所有符合条件的用户。</p>}
          impact={
            confirming === 'invite' && invite
              ? [
                  `邀请人获得 ${invite.inviterCredits} 积分`,
                  `被邀请人获得 ${invite.inviteeCredits} 积分`,
                  invite.triggerOn === 'register' ? '注册即发放' : '首次支付后发放',
                  invite.valid ? '规则已启用' : '规则将停用',
                ]
              : checkin
                ? [
                    `每日基础 ${checkin.baseCredits} 积分`,
                    ...checkin.bonusRules.map((b) => `连续 ${b.day} 天额外 +${b.bonus}`),
                    '已签到记录不受影响',
                  ]
                : []
          }
          extra={
            <div className="adm-confirm-warn">
              <Gift size={14} />
              <span>已发放的积分不会被追回或扣减，只影响后续发放。</span>
            </div>
          }
        />
      )}
    </>
  );
}