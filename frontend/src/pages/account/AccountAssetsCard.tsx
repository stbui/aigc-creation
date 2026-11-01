import { Button } from 'antd';
import { Wallet } from 'lucide-react';

import type { CreditBalance, MyMembership } from '../../types/api';
import { fmtDate } from './utils';

/**
 * 积分与会员卡。
 *
 * 两格并排: 左格回答「还剩多少积分、会不会过期」, 右格回答「是不是会员、什么时候到期」。
 * 加载失败的附加接口保持空白文案而不是整页错误 —— 与页面 `allSettled` 的取数策略一致。
 */
export function AccountAssetsCard({
  credits,
  membership,
  cancelling,
  onCancelMembership,
  onNavigate,
}: {
  credits: CreditBalance | null;
  membership: MyMembership | null;
  cancelling: boolean;
  onCancelMembership: () => void;
  onNavigate: (to: string) => void;
}) {
  return (
    <section className="account-card">
      <header className="account-card-head">
        <Wallet size={15} aria-hidden />
        <h2>积分与会员</h2>
        <Button
          type="link"
          size="small"
          className="account-card-more"
          onClick={() => onNavigate('/credits')}
        >
          查看积分明细
        </Button>
      </header>
      <div className="account-assets">
        <div className="account-asset">
          <span className="account-asset-label">可用积分</span>
          <b>{credits ? credits.balance.toLocaleString('zh-CN') : '—'}</b>
          <small>
            {credits
              ? credits.expiringSoon > 0
                ? `${credits.expiringSoon} 积分将在 30 天内到期（最近 ${fmtDate(credits.nearestExpiry)}）`
                : '暂无即将到期的积分'
              : '积分余额加载失败，可前往积分明细页查看'}
          </small>
          <div className="account-asset-actions">
            <Button size="small" onClick={() => onNavigate('/packages')}>
              购买积分
            </Button>
          </div>
        </div>
        <div className={`account-asset${membership?.isMember ? ' is-member' : ''}`}>
          <span className="account-asset-label">会员状态</span>
          <b>{membership?.isMember ? membership.planName : '普通用户'}</b>
          <small>
            {membership?.isMember
              ? `有效期至 ${fmtDate(membership.expiresAt)} · 每月赠送 ${membership.monthlyCredits} 积分`
              : '开通会员享专属折扣与每月赠送积分'}
          </small>
          <div className="account-asset-actions">
            <Button
              size="small"
              type={membership?.isMember ? 'default' : 'primary'}
              onClick={() => onNavigate('/packages')}
            >
              {membership?.isMember ? '续费会员' : '开通会员'}
            </Button>
            {membership?.isMember && !membership.cancelAtPeriodEnd && (
              <Button size="small" type="text" danger loading={cancelling} onClick={onCancelMembership}>
                取消自动续费
              </Button>
            )}
          </div>
          {membership?.isMember && membership.cancelAtPeriodEnd && (
            <span className="account-hint">已取消自动续费，权益保留至 {fmtDate(membership.expiresAt)}</span>
          )}
        </div>
      </div>
    </section>
  );
}
