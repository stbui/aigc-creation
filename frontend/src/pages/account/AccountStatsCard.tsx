import { BarChart3, ChevronRight, FolderOpen, Image as ImageIcon, Images, MessageSquare, Receipt } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { MyProfile } from '../../types/api';
import { ACCOUNT_CARD, ACCOUNT_CARD_HEAD } from './constants';

/**
 * 「我的数据」卡。
 *
 * 每格都是入口: 图标帮扫读; 工单数来自独立的工单接口而非 `/me.counts`,
 * 所以由调用方单独传 `ticketTotal`, 缺省显示「—」而不是 0。
 */
export function AccountStatsCard({
  counts,
  ticketTotal,
}: {
  counts: MyProfile['counts'] | undefined;
  ticketTotal: number | null;
}) {
  const stats: Array<{ label: string; value: number | null; to: string; icon: ReactNode }> = [
    { label: '项目', value: counts?.projects ?? null, to: '/library', icon: <FolderOpen size={13} aria-hidden /> },
    { label: '作品', value: counts?.tasks ?? null, to: '/works', icon: <ImageIcon size={13} aria-hidden /> },
    { label: '素材', value: counts?.assets ?? null, to: '/library', icon: <Images size={13} aria-hidden /> },
    { label: '订单', value: counts?.orders ?? null, to: '/orders', icon: <Receipt size={13} aria-hidden /> },
    { label: '工单', value: ticketTotal, to: '/tickets', icon: <MessageSquare size={13} aria-hidden /> },
  ];

  return (
    <section className={ACCOUNT_CARD}>
      <header className={ACCOUNT_CARD_HEAD}>
        <BarChart3 size={15} aria-hidden className="flex-none text-muted-foreground" />
        <h2 className="m-0 text-sm font-semibold">我的数据</h2>
      </header>
      <div className="grid grid-cols-5 gap-2.5 max-[900px]:grid-cols-3 max-[640px]:grid-cols-2">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            className="flex flex-col gap-1.5 rounded-md border border-[var(--border-row)] bg-card px-3.5 py-3 text-inherit no-underline transition-colors hover:border-brand hover:bg-brand-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand [&:hover_.stat-arrow]:translate-x-0.5 [&:hover_.stat-arrow]:text-brand [&:hover_.stat-arrow]:opacity-100"
            to={stat.to}
          >
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="flex-none text-muted-foreground">{stat.icon}</span>
              {stat.label}
              <ChevronRight
                size={13}
                className="stat-arrow ml-auto flex-none text-muted-foreground opacity-50 transition-[opacity,transform]"
                aria-hidden
              />
            </span>
            <b className="text-xl font-semibold text-foreground tabular-nums">{stat.value ?? '—'}</b>
          </Link>
        ))}
      </div>
    </section>
  );
}
