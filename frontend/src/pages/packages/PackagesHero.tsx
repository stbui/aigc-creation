import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Gem, Wallet } from 'lucide-react';

import { formatNumber } from './utils';

interface PackagesHeroProps {
  loggedIn: boolean;
  balance: number | null;
}

/** 商城页头：返回、标题与当前积分入口。 */
export function PackagesHero({ loggedIn, balance }: PackagesHeroProps) {
  const navigate = useNavigate();

  return (
    <>
      <button type="button" className="pkg-back-btn" onClick={() => navigate(-1)}>
        <ArrowLeft size={14} aria-hidden /> 返回
      </button>

      <header className="pkg-shop-hero">
        <div className="pkg-shop-hero-main">
          <span className="pkg-shop-hero-icon">
            <Gem size={22} aria-hidden />
          </span>
          <div className="pkg-shop-hero-copy">
            <h1>积分商城</h1>
            <p>积分可用于解锁全部 AI 创作能力，按需购买</p>
          </div>
        </div>
        {loggedIn && (
          <button
            type="button"
            className="pkg-shop-balance"
            onClick={() => navigate('/credits')}
            title="查看积分明细"
          >
            <Wallet size={15} aria-hidden />
            <span>当前积分</span>
            <strong>{balance ? formatNumber(balance) : '—'}</strong>
            <ChevronRight size={14} aria-hidden />
          </button>
        )}
      </header>
    </>
  );
}
