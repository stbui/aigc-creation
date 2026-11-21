import { Link, useNavigate } from 'react-router-dom';
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
      <button
        type="button"
        className="mb-4 inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent py-2 text-[13px] font-semibold text-[color:var(--text-muted)] hover:text-foreground max-[640px]:mb-3"
        onClick={() => navigate(-1)}
      >
        <ArrowLeft size={14} aria-hidden /> 返回
      </button>

      <header className="mt-1 mb-7 flex items-center justify-between gap-5 rounded-2xl border border-border bg-[linear-gradient(120deg,var(--brand-bg)_0,var(--card-bg)_62%)] px-6 py-[22px] max-[900px]:flex-col max-[900px]:items-stretch max-[900px]:gap-4 max-[900px]:px-5 max-[900px]:py-5 max-[640px]:rounded-xl max-[640px]:px-4 max-[640px]:py-[18px]">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="grid size-[46px] shrink-0 place-items-center rounded-lg bg-brand text-primary-foreground shadow-[0_8px_18px_rgba(85,70,216,0.22)]">
            <Gem size={22} aria-hidden />
          </span>
          <div>
            <h1 className="mx-0 mt-0 mb-1.5 text-[22px] leading-[30px] tracking-[-0.3px] text-foreground max-[640px]:text-xl">
              积分商城
            </h1>
            <p className="m-0 text-[13px] leading-5 text-[color:var(--text-muted)]">
              积分可用于解锁全部 AI 创作能力，按需购买
            </p>
          </div>
        </div>
        {loggedIn && (
          <Link
            className="group inline-flex h-[38px] shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3.5 text-xs text-[color:var(--text-muted)] no-underline transition-colors hover:border-brand hover:text-brand max-[900px]:w-full max-[900px]:justify-start"
            to="/credits"
            title="查看积分明细"
          >
            <Wallet size={15} aria-hidden />
            <span>当前积分</span>
            <strong className="text-[15px] font-bold tabular-nums text-foreground transition-colors group-hover:text-brand">
              {balance ? formatNumber(balance) : '—'}
            </strong>
            <ChevronRight size={14} aria-hidden />
          </Link>
        )}
      </header>
    </>
  );
}
