import { Wallet } from 'lucide-react';

import type { CreditBalance } from '../../types/api';
import { Surface, SurfaceContent } from './components';
import { formatDate } from './utils';

interface CreditsHeroProps {
  balance: CreditBalance | null;
}

/** 顶部余额卡：可用积分、最近到期日与扣减口径。 */
export function CreditsHero({ balance }: CreditsHeroProps) {
  return (
    <Surface className="rounded-xl border border-border bg-[linear-gradient(120deg,var(--brand-bg)_0%,var(--card-bg)_62%)]">
      <SurfaceContent className="flex flex-col items-start gap-5 px-5 py-5 min-[901px]:flex-row min-[901px]:items-center min-[901px]:justify-between min-[901px]:px-6">
      <div className="flex min-w-0 items-center gap-3.5">
        <span
          className="grid size-11 flex-none place-items-center rounded-lg bg-card text-brand shadow-[0_2px_10px_color-mix(in_oklab,var(--brand)_12%,transparent)]"
          aria-hidden
        >
          <Wallet size={22} />
        </span>
        <div>
          <div className="text-xs font-medium text-muted-foreground">当前可用积分</div>
          <div className="mt-0.5 text-[30px] leading-[1.2] font-bold text-foreground tabular-nums">
            {balance?.balance ?? '—'}
          </div>
          <div className="mt-1 text-[13px] leading-5 text-muted-foreground">
            {balance && balance.activeLots > 0 ? (
              <>
                {balance.nearestExpiry
                  ? `最近一笔将于 ${formatDate(balance.nearestExpiry)} 到期，`
                  : '积分永久有效，'}
                <span className="whitespace-nowrap">积分按到期先后扣减</span>
              </>
            ) : (
              '暂无可用批次，购买积分或开通会员后即可使用'
            )}
          </div>
        </div>
      </div>
      {/*
       * 只在真的有积分将要到期时才占位。没有到期项时这里原本写着
       * 「暂无即将到期的积分」，和下面「30 天内到期 0」是同一句话，
       * 还会在窄屏折行后把 hero 撑成两段。
       */}
      {balance && balance.expiringSoon > 0 && balance.nearestExpiry && (
        <div className="flex-none text-left min-[901px]:text-right">
          <span className="inline-block rounded-full bg-warn-soft px-2.5 py-1 text-xs text-warn-text">
            {balance.expiringSoon} 积分将于 {formatDate(balance.nearestExpiry)} 到期
          </span>
        </div>
      )}
      </SurfaceContent>
    </Surface>
  );
}
