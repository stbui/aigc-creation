import { BarChart3, ChevronRight, FolderOpen, Image as ImageIcon, Images, MessageSquare, Receipt } from 'lucide-react';
import type { ReactNode } from 'react';

import type { MyProfile } from '../../types/api';

/**
 * 「我的数据」卡。
 *
 * 每格都是入口: 图标帮扫读; 工单数来自独立的工单接口而非 `/me.counts`,
 * 所以由调用方单独传 `ticketTotal`, 缺省显示「—」而不是 0。
 */
export function AccountStatsCard({
  counts,
  ticketTotal,
  onNavigate,
}: {
  counts: MyProfile['counts'] | undefined;
  ticketTotal: number | null;
  onNavigate: (to: string) => void;
}) {
  const stats: Array<{ label: string; value: number | null; to: string; icon: ReactNode }> = [
    { label: '项目', value: counts?.projects ?? null, to: '/library', icon: <FolderOpen size={13} aria-hidden /> },
    { label: '作品', value: counts?.tasks ?? null, to: '/works', icon: <ImageIcon size={13} aria-hidden /> },
    { label: '素材', value: counts?.assets ?? null, to: '/library', icon: <Images size={13} aria-hidden /> },
    { label: '订单', value: counts?.orders ?? null, to: '/orders', icon: <Receipt size={13} aria-hidden /> },
    { label: '工单', value: ticketTotal, to: '/tickets', icon: <MessageSquare size={13} aria-hidden /> },
  ];

  return (
    <section className="account-card">
      <header className="account-card-head">
        <BarChart3 size={15} aria-hidden />
        <h2>我的数据</h2>
      </header>
      <div className="account-stats">
        {stats.map((stat) => (
          <button
            key={stat.label}
            type="button"
            className="account-stat"
            onClick={() => onNavigate(stat.to)}
          >
            <span className="account-stat-label">
              {stat.icon}
              {stat.label}
              <ChevronRight size={13} className="account-stat-arrow" aria-hidden />
            </span>
            <b>{stat.value ?? '—'}</b>
          </button>
        ))}
      </div>
    </section>
  );
}
