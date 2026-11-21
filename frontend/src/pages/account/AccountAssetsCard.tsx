import { Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { CreditBalance, MyMembership } from '../../types/api';
import { fmtDate, formatNumber } from './utils';
import { ACCOUNT_CARD, ACCOUNT_CARD_HEAD } from './constants';
import { Button } from '../../ui';

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
}: {
  credits: CreditBalance | null;
  membership: MyMembership | null;
  cancelling: boolean;
  onCancelMembership: () => void;
}) {
  return (
    <section className={ACCOUNT_CARD}>
      <header className={ACCOUNT_CARD_HEAD}>
        <Wallet size={15} aria-hidden className="flex-none text-muted-foreground" />
        <h2 className="m-0 text-sm font-semibold">积分与会员</h2>
        <Button asChild variant="link" size="sm" className="ml-auto p-0 text-xs">
          <Link to="/credits">查看积分明细</Link>
        </Button>
      </header>
      <div className="grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
        <div className="flex flex-col items-start gap-1.5 rounded-lg border border-[var(--border-row)] bg-muted px-[18px] py-4">
          <span className="text-xs text-muted-foreground">可用积分</span>
          <b className="text-2xl leading-[1.15] font-semibold text-foreground tabular-nums">
            {formatNumber(credits?.balance)}
          </b>
          <small className="text-xs leading-relaxed text-muted-foreground">
            {credits
              ? credits.expiringSoon > 0
                ? `${credits.expiringSoon} 积分将在 30 天内到期（最近 ${fmtDate(credits.nearestExpiry)}）`
                : '暂无即将到期的积分'
              : '积分余额加载失败，可前往积分明细页查看'}
          </small>
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
            <Button asChild size="sm">
              <Link to="/packages">购买积分</Link>
            </Button>
          </div>
        </div>
        <div
          className={`flex flex-col items-start gap-1.5 rounded-lg border px-[18px] py-4 ${
            membership?.isMember
              ? 'border-[color-mix(in_srgb,var(--brand)_22%,transparent)] bg-[linear-gradient(135deg,var(--brand-bg)_0%,var(--card-bg)_70%)]'
              : 'border-[var(--border-row)] bg-muted'
          }`}
        >
          <span className="text-xs text-muted-foreground">会员状态</span>
          <b className="text-2xl leading-[1.15] font-semibold text-foreground tabular-nums">
            {membership?.isMember ? membership.planName : '普通用户'}
          </b>
          <small className="text-xs leading-relaxed text-muted-foreground">
            {membership?.isMember
              ? `有效期至 ${fmtDate(membership.expiresAt)} · 每月赠送 ${membership.monthlyCredits} 积分`
              : '开通会员享专属折扣与每月赠送积分'}
          </small>
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
            <Button asChild size="sm" variant={membership?.isMember ? 'outline' : 'default'}>
              <Link to="/packages">{membership?.isMember ? '续费会员' : '开通会员'}</Link>
            </Button>
            {membership?.isMember && !membership.cancelAtPeriodEnd && (
              <Button disabled={cancelling} size="sm" variant="ghost" onClick={onCancelMembership}>
                {cancelling && <span className="state-spinner is-small" aria-hidden />}
                取消自动续费
              </Button>
            )}
          </div>
          {membership?.isMember && membership.cancelAtPeriodEnd && (
            <span className="text-xs leading-relaxed text-muted-foreground">
              已取消自动续费，权益保留至 {fmtDate(membership.expiresAt)}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
