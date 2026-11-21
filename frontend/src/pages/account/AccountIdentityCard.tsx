import { Gem, Gift, LifeBuoy, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { MyProfile } from '../../types/api';
import { fmtDate, fmtDateTime } from './utils';
import { ACCOUNT_CARD } from './constants';
import { Avatar, AvatarFallback, Button, Input } from '../../ui';

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
}: {
  profile: MyProfile | null;
  unread: number;
  name: string;
  nameDirty: boolean;
  savingName: boolean;
  onNameChange: (value: string) => void;
  onSaveName: () => void;
}) {
  const avatarChar = (profile?.name || profile?.email || 'U').charAt(0).toUpperCase();
  const pill = 'inline-flex items-center rounded-full px-2 py-px text-xs font-medium leading-5 whitespace-nowrap';

  return (
    <section className={ACCOUNT_CARD}>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar className="size-16 shrink-0 bg-brand text-[22px] font-semibold text-primary-foreground">
          <AvatarFallback className="bg-brand text-[22px] font-semibold text-primary-foreground">
            {avatarChar}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-[19px] leading-[1.3] font-semibold text-foreground [overflow-wrap:anywhere]">
              {profile?.name || '未设置昵称'}
            </h2>
            <span
              className={`${pill} ${
                profile?.status === 'active'
                  ? 'bg-success-soft text-success-text'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {profile?.status === 'active' ? '正常' : profile?.status || '—'}
            </span>
            {unread > 0 && <span className={`${pill} bg-brand-bg text-brand`}>{unread} 条未读消息</span>}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            <span>注册于 {fmtDate(profile?.createdAt)}</span>
            <span>上次登录 {fmtDateTime(profile?.lastLoginAt)}</span>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2 max-[900px]:ml-0 max-[900px]:flex-[1_1_100%]">
          <Button asChild variant="default" className="max-[900px]:flex-1">
            <Link to="/credits">
              <Wallet size={14} aria-hidden />
              积分明细
            </Link>
          </Button>
          <Button asChild className="max-[900px]:flex-1">
            <Link to="/packages">
              <Gem size={14} aria-hidden />
              购买套餐
            </Link>
          </Button>
          <Button asChild className="max-[900px]:flex-1">
            <Link to="/tickets">
              <LifeBuoy size={14} aria-hidden />
              我的工单
            </Link>
          </Button>
          {/* 邀请 / 签到此前只有顶导一个入口, 个人主页是用户找「还能做什么」的地方 */}
          <Button asChild className="max-[900px]:flex-1">
            <Link to="/invitations">
              <Gift size={14} aria-hidden />
              邀请有礼
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-[18px] border-t border-[var(--border-row)] pt-1">
        <div className="flex items-start gap-4 py-[9px] text-[13px] max-[640px]:flex-col max-[640px]:gap-0.5 max-[640px]:py-2.5">
          <span className="flex-[0_0_56px] leading-8 text-muted-foreground max-[640px]:flex-none max-[640px]:text-xs max-[640px]:leading-normal">
            邮箱
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5 text-muted-foreground max-[640px]:w-full">
            <span className="leading-8 break-all text-muted-foreground max-[640px]:leading-normal">
              {profile?.email}
            </span>
            <span
              className={`${pill} ${
                profile?.emailVerifiedAt
                  ? 'bg-success-soft text-success-text'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {profile?.emailVerifiedAt ? '已验证' : '未验证'}
            </span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              登录标识，已用于订单与发票，暂不支持修改
            </span>
          </div>
        </div>
        <div className="flex items-start gap-4 border-t border-dashed border-[var(--border-row)] py-[9px] text-[13px] max-[640px]:flex-col max-[640px]:gap-0.5 max-[640px]:py-2.5">
          <span className="flex-[0_0_56px] leading-8 text-muted-foreground max-[640px]:flex-none max-[640px]:text-xs max-[640px]:leading-normal">
            昵称
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5 text-muted-foreground max-[640px]:w-full">
            <Input
              className="w-[220px] max-[900px]:w-full max-[640px]:[&]:w-full max-[640px]:[&]:flex-[1_1_100%]"
              value={name}
              maxLength={20}
              onChange={(e) => onNameChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && nameDirty) onSaveName(); }}
            />
            <Button
              size="sm"
              variant={nameDirty ? 'default' : 'outline'}
              disabled={!nameDirty || savingName}
              onClick={onSaveName}
            >
              {savingName && <span className="state-spinner is-small" aria-hidden />}
              保存
            </Button>
          </div>
        </div>
        <div className="flex items-start gap-4 border-t border-dashed border-[var(--border-row)] py-[9px] text-[13px] max-[640px]:flex-col max-[640px]:gap-0.5 max-[640px]:py-2.5">
          <span className="flex-[0_0_56px] leading-8 text-muted-foreground max-[640px]:flex-none max-[640px]:text-xs max-[640px]:leading-normal">
            手机号
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5 text-muted-foreground max-[640px]:w-full">
            <span className="leading-8 break-all text-muted-foreground max-[640px]:leading-normal">
              {profile?.phone ?? '未绑定'}
            </span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              暂不支持自助绑定/更换；如需协助请联系客服
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
