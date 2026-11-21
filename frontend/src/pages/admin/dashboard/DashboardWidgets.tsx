import type { ReactNode } from 'react';
import { Meter } from './components';
import type { AdminOverview } from '../../../types/api';
import { formatNumber, yuan } from './utils';
import '../../../styles/radar-admin.css';

/**
 * 概览页展示小节。
 *
 * 这里只放「怎么画」：财务读数与概览内的通用排版件。
 * 取数、权限判定与页面编排留在 `AdminDashboardContent`。
 */

/** 小节副标题：标题 + 口径说明 */
export function Subhead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-2.5 flex items-baseline gap-2 text-[13px] font-semibold text-foreground">
      <span>{title}</span>
      {note && <span className="text-[13px] font-normal text-muted-foreground">{note}</span>}
    </div>
  );
}

/** 行内空态：说明「为什么空」，不占整块空间 */
export function EmptyInline({ children }: { children: ReactNode }) {
  return <div className="py-6 text-[13px] leading-5 text-muted-foreground">{children}</div>;
}

/** 占比行：失败原因与渠道构成共用一套排版。 */
export function MeterRow({
  label,
  title,
  value,
  total,
  hint,
  tone = 'brand',
}: {
  label: string;
  title?: string;
  value: number;
  total: number;
  hint?: string;
  tone?: 'brand' | 'danger';
}) {
  return (
    <div className="grid grid-cols-[minmax(96px,160px)_minmax(120px,1fr)_auto] items-center gap-2.5 text-[13px]">
      <span className="truncate text-muted-foreground" title={title ?? label}>
        {label}
      </span>
      <Meter
        value={Math.max((value / Math.max(total, 1)) * 100, 2)}
        tone={tone === 'danger' ? 'danger' : 'brand'}
        className="h-2"
        decorative
      />
      <span className="text-right whitespace-nowrap text-muted-foreground tabular-nums">
        {hint ?? String(value)}
      </span>
    </div>
  );
}

/** 财务视角的机器状态：交易口径的关键读数，不做任务成功率 */
export function FinanceGrid({
  commerce,
  days,
}: {
  commerce: AdminOverview['commerce'];
  days: number;
}) {
  const items: Array<{ label: string; value: string; tone?: 'danger' | 'warn' }> = [
    /*
     * 口径写进标签：这里是**订单实付**（元，Σ `Order.paidCents`），
     * 与财务分析页的「净收入（积分）」（已结算账单金额）不是同一笔账。
     * 两个都叫「营收」会让人把两处数字对在一起，对不上就以为其中一处坏了。
     */
    { label: `近 ${days} 天营收（元）`, value: `¥${yuan(commerce.gmvWindowCents)}` },
    {
      label: '支付成功率',
      value: commerce.paymentSuccessRate === null ? '—' : `${commerce.paymentSuccessRate}%`,
    },
    { label: '待付金额', value: `¥${yuan(commerce.pendingCents, 0)}` },
    {
      label: `近 ${days} 天退款`,
      value: `¥${yuan(commerce.refundedWindowCents)}`,
      tone: commerce.refundedWindowCents > 0 ? 'danger' : undefined,
    },
    { label: '有效会员', value: formatNumber(commerce.members.active) },
    {
      label: `近 ${days} 天积分消耗`,
      value: formatNumber(commerce.credits.consumedInWindow),
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="mb-0.5 overflow-hidden text-[13px] text-ellipsis whitespace-nowrap text-muted-foreground">
            {item.label}
          </dt>
          <dd
            className={
              item.tone === 'danger'
                ? 'text-base leading-5 font-semibold tracking-tight text-danger-text'
                : item.tone === 'warn'
                  ? 'text-base leading-5 font-semibold tracking-tight text-warn-text'
                  : 'text-base leading-5 font-semibold tracking-tight text-foreground'
            }
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
