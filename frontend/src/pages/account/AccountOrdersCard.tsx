import { Receipt } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { Order } from '../../types/api';
import { ACCOUNT_CARD, ACCOUNT_CARD_HEAD, ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from './constants';
import { fmtDateTime, fmtYuan } from './utils';
import { Button } from '../../ui';

/**
 * 最近订单卡。
 *
 * 只展示最近几笔 (后端已倒序, 页面按 `RECENT_ORDER_LIMIT` 截断);
 * 每行整块可点, 统一跳到「全部订单」而不是单笔详情 —— 详情页路由尚未拆分。
 */
export function AccountOrdersCard({ orders }: { orders: Order[] }) {
  return (
    <section className={ACCOUNT_CARD}>
      <header className={ACCOUNT_CARD_HEAD}>
        <Receipt size={15} aria-hidden className="flex-none text-muted-foreground" />
        <h2 className="m-0 text-sm font-semibold">最近订单</h2>
        <Button asChild variant="link" size="sm" className="ml-auto p-0 text-xs">
          <Link to="/orders">全部订单</Link>
        </Button>
      </header>
      {orders.length === 0 ? (
        <p className="m-0 px-0 pt-3 pb-0.5 text-[13px] text-muted-foreground">
          暂无订单。
          <Button asChild variant="link" size="sm">
            <Link to="/packages">去购买积分或会员</Link>
          </Button>
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                className="flex w-full items-center gap-3 rounded-md border border-[var(--border-row)] bg-card px-3 py-2.5 text-inherit no-underline transition-colors hover:border-brand hover:bg-brand-bg"
                to="/orders"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-muted-foreground">
                    {order.membershipPlanName ||
                      order.items.map((item) => item.name).join('、') ||
                      order.orderNo}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {order.orderNo} · {fmtDateTime(order.createdAt, true)}
                  </span>
                </span>
                <span className="flex-none text-sm font-semibold text-foreground">
                  {fmtYuan(order.paidCents)}
                </span>
                <span
                  className={`flex-none rounded-sm px-2 py-0.5 text-xs ${ORDER_STATUS_TONE[order.status]}`}
                >
                  {ORDER_STATUS_LABEL[order.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
