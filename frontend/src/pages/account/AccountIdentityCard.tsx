import { Gem, Gift, LifeBuoy, Wallet } from 'lucide-react';

import type { MyProfile } from '../../types/api';
import { fmtDate, fmtDateTime } from './utils';
import { Avatar, Button, Input } from '../../ui';

/**
 * 身份与资料卡。
 *
 * 上排只回答「我是谁」(头像 / 昵称 / 状态 / 注册与登录时间 + 快捷入口),
 * 下排只回答「哪些能改」(邮箱只读、昵称可编辑、手机号需短信验证)。
 *
 * 昵称的输入框是受控的: 值、脏标记与保存动作都由页面持有 ——
 * 页面离开前的未保存提示依赖同一份状态, 不能下沉到组件里。
 */
export function AccountIdentityCard({
  profile,
  unread,
  name,
  nameDirty,
  savingName,
  onNameChange,
  onSaveName,
  onNavigate,
}: {
  profile: MyProfile | null;
  unread: number;
  name: string;
  nameDirty: boolean;
  savingName: boolean;
  onNameChange: (value: string) => void;
  onSaveName: () => void;
  onNavigate: (to: string) => void;
}) {
  const avatarChar = (profile?.name || profile?.email || 'U').charAt(0).toUpperCase();

  return (
    <section className="account-card account-identity">
      <div className="account-identity-head">
        <Avatar size={64} className="account-avatar">
          {avatarChar}
        </Avatar>
        <div className="account-identity-info">
          <div className="account-identity-name">
            <h2>{profile?.name || '未设置昵称'}</h2>
            <span className={`account-pill${profile?.status === 'active' ? ' is-ok' : ' is-muted'}`}>
              {profile?.status === 'active' ? '正常' : profile?.status || '—'}
            </span>
            {unread > 0 && <span className="account-pill is-brand">{unread} 条未读消息</span>}
          </div>
          <div className="account-identity-meta">
            <span>注册于 {fmtDate(profile?.createdAt)}</span>
            <span>上次登录 {fmtDateTime(profile?.lastLoginAt)}</span>
          </div>
        </div>
        <div className="account-quick">
          <Button type="primary" icon={<Wallet size={14} />} onClick={() => onNavigate('/credits')}>
            积分明细
          </Button>
          <Button icon={<Gem size={14} />} onClick={() => onNavigate('/packages')}>
            购买套餐
          </Button>
          <Button icon={<LifeBuoy size={14} />} onClick={() => onNavigate('/tickets')}>
            我的工单
          </Button>
          {/* 邀请 / 签到此前只有顶导一个入口, 个人主页是用户找「还能做什么」的地方 */}
          <Button icon={<Gift size={14} />} onClick={() => onNavigate('/invitations')}>
            邀请有礼
          </Button>
        </div>
      </div>

      <div className="account-fields">
        <div className="account-field">
          <span className="account-field-label">邮箱</span>
          <div className="account-field-value">
            <span className="account-field-text">{profile?.email}</span>
            <span className="account-hint">登录标识，已用于订单与发票，暂不支持修改</span>
          </div>
        </div>
        <div className="account-field">
          <span className="account-field-label">昵称</span>
          <div className="account-field-value">
            <Input
              className="account-nick-input"
              value={name}
              maxLength={20}
              onChange={(e) => onNameChange(e.target.value)}
              onPressEnter={() => nameDirty && onSaveName()}
            />
            <Button
              size="small"
              type={nameDirty ? 'primary' : 'default'}
              disabled={!nameDirty}
              loading={savingName}
              onClick={onSaveName}
            >
              保存
            </Button>
          </div>
        </div>
        <div className="account-field">
          <span className="account-field-label">手机号</span>
          <div className="account-field-value">
            <span className="account-field-text">{profile?.phone ?? '未绑定'}</span>
            <span className="account-hint">暂不支持自助绑定/更换；如需协助请联系客服</span>
          </div>
        </div>
      </div>
    </section>
  );
}
