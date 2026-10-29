import { useEffect, useState } from 'react';
import { App, Button, Input, Select, Switch } from 'antd';
import { Plus, Trash2 } from 'lucide-react';
import { marketingApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  useAdminResource,
} from '../../components/admin/AdminWidgets';
import { PageHeader, Panel } from '../../components/admin/PageHeader';
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

  // 只有完全没有数据时才塌整页; 已有草稿时保留表单, 由下方 stale 提示交代刷新失败
  if (loading && !data) return <AdminListLoading tip="加载营销规则…" />;
  // 重试只重跑本页的两次请求, 不整页刷新 —— reload 会丢掉 C 端的路由参数与滚动位置
  if (error && !data) return <AdminListError error={error} onRetry={() => void reload()} />;

  const saveInvite = async () => {
    if (!invite) return;
    setBusy(true);
    try {
      const saved = await marketingApi.updateInviteRule(invite);
      setInvite(saved);
      setInviteBase(saved);
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
      const saved = await marketingApi.updateCheckinRule(checkin);
      setCheckin(saved);
      setCheckinBase(saved);
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

      {error && <AdminStaleError error={error} onRetry={() => void reload()} />}

      {/* 邀请规则 */}
      <Panel title="邀请分销规则" note="奖励在触发条件满足时自动发放">
        {invite && (
          <div className="adm-form">
            <div className="adm-form-row">
              <div className="adm-field">
                <label htmlFor="i-inviter">邀请人奖励 (积分)</label>
                <Input
                  id="i-inviter"
                  type="number"
                  value={invite.inviterCredits}
                  disabled={!writable}
                  onChange={(e) => setInvite({ ...invite, inviterCredits: Number(e.target.value) })}
                />
              </div>
              <div className="adm-field">
                <label htmlFor="i-invitee">被邀请人奖励 (积分)</label>
                <Input
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
                <Select
                  id="i-trigger"
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
                <div className="adm-field-hint">
                  选「注册后」奖励门槛低但易被刷，选「首次支付」更稳妥
                </div>
              </div>
              <div className="adm-field">
                <Switch
                  checked={invite.valid}
                  disabled={!writable}
                  checkedChildren="启用邀请奖励"
                  onChange={(checked) => setInvite({ ...invite, valid: checked })}
                />
              </div>
            </div>

            {writable && (
              <div className="adm-action-bar" style={{ position: 'static' }}>
                <span className="adm-action-hint">
                  {inviteDirty && '有未保存修改 · '}
                  邀请人得 {invite.inviterCredits} 分，被邀请人得 {invite.inviteeCredits} 分
                </span>
                {inviteDirty && (
                  <Button
                    type="default"
                    className="adm-btn"
                    disabled={busy}
                    onClick={() => setInvite(inviteBase)}
                  >
                    放弃变更
                  </Button>
                )}
                <Button
                  type="primary"
                  className="adm-btn is-primary"
                  onClick={() => void saveInvite()}
                  disabled={busy}
                >
                  保存邀请规则
                </Button>
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
              <Input
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
                    <Input
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
                    <Input
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
                      <Button
                        type="link" danger
                        className="adm-link is-danger"
                        onClick={() =>
                          setCheckin({
                            ...checkin,
                            bonusRules: checkin.bonusRules.filter((_, j) => j !== i),
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {writable && (
                <Button
                  type="default"
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
                </Button>
              )}
            </div>

            <div className="adm-field">
              <Switch
                checked={checkin.enabled}
                disabled={!writable}
                checkedChildren="启用签到"
                onChange={(checked) => setCheckin({ ...checkin, enabled: checked })}
              />
            </div>

            {writable && (
              <div className="adm-action-bar" style={{ position: 'static' }}>
                <span className="adm-action-hint">
                  {checkinDirty && '有未保存修改 · '}
                  基础 {checkin.baseCredits} 分/天 · {checkin.bonusRules.length} 个加成档位
                </span>
                {checkinDirty && (
                  <Button
                    type="default"
                    className="adm-btn"
                    disabled={busy}
                    onClick={() => setCheckin(checkinBase)}
                  >
                    放弃变更
                  </Button>
                )}
                <Button
                  type="primary"
                  className="adm-btn is-primary"
                  onClick={() => void saveCheckin()}
                  disabled={busy}
                >
                  保存签到规则
                </Button>
              </div>
            )}
          </div>
        )}
      </Panel>

    </>
  );
}
