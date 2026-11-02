import { Receipt } from 'lucide-react';

import type { Order } from '../../types/api';
import { ORDER_STATUS_LABEL } from './constants';
import { fmtDateTime, fmtYuan } from './utils';
import { Button } from '../../ui';

/**
 * 最近订单卡。
 *
 * 只展示最近几笔 (后端已倒序, 页面按 `RECENT_ORDER_LIMIT` 截断);
 * 每行整块可点, 统一跳到「全部订单」而不是单笔详情 —— 详情页路由尚未拆分。
 */
export function AccountOrdersCard({
  orders,
  onNavigate,
}: {
  orders: Order[];
  onNavigate: (to: string) => void;
}) {
  return (
    <section className="account-card">
      <header className="account-card-head">
        <Receipt size={15} aria-hidden />
        <h2>最近订单</h2>
        <Button
          type="link"
          size="small"
          className="account-card-more"
          onClick={() => onNavigate('/orders')}
        >
          全部订单
        </Button>
      </header>
      {orders.length === 0 ? (
        <p className="account-empty">
          暂无订单。
          <Button type="link" size="small" onClick={() => onNavigate('/packages')}>
            去购买积分或会员
          </Button>
        </p>
      ) : (
        <ul className="account-order-list">
          {orders.map((order) => (
            <li key={order.id}>
              <button type="button" className="account-order" onClick={() => onNavigate('/orders')}>
                <span className="account-order-main">
                  <span className="account-order-title">
                    {order.membershipPlanName ||
                      order.items.map((item) => item.name).join('、') ||
                      order.orderNo}
                  </span>
                  <span className="account-order-meta">
                    {order.orderNo} · {fmtDateTime(order.createdAt, true)}
                  </span>
                </span>
                <span className="account-order-amount">{fmtYuan(order.paidCents)}</span>
                <span className={`account-order-status is-${order.status}`}>
                  {ORDER_STATUS_LABEL[order.status]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
