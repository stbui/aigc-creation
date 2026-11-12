import { Wallet } from 'lucide-react';

import type { CreditBalance } from '../../types/api';
import { Card } from './components';
import { formatDate } from './utils';

interface CreditsHeroProps {
  balance: CreditBalance | null;
}

/** 顶部余额卡：可用积分、最近到期日与扣减口径。 */
export function CreditsHero({ balance }: CreditsHeroProps) {
  return (
    <Card className="credits-hero" variant="borderless">
      <div className="credits-hero-main">
        <span className="credits-hero-icon" aria-hidden>
          <Wallet size={22} />
        </span>
        <div>
          <div className="credits-hero-label">当前可用积分</div>
          <div className="credits-hero-value">{balance?.balance ?? '—'}</div>
          <div className="credits-hero-note">
            {balance && balance.activeLots > 0 ? (
              <>
                {balance.nearestExpiry
                  ? `最近一笔将于 ${formatDate(balance.nearestExpiry)} 到期，`
                  : '积分永久有效，'}
                <span className="credits-hero-rule">积分按到期先后扣减</span>
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
        <div className="credits-hero-side">
          <span className="credits-hero-warn">
            {balance.expiringSoon} 积分将于 {formatDate(balance.nearestExpiry)} 到期
          </span>
        </div>
      )}
    </Card>
  );
}
