import { Link } from 'react-router-dom';
import {
  DetailSection,
  EmptyState,
  StatusTag,
  formatYuan,
} from '~/admin-ui/primitives';
import { cn } from '~/admin-ui/lib/cn';
import type {
  AdminUserRecentOrder,
  AdminUserSpending,
} from '../../../types/admin-users';
import { adminOrderDetailHref, adminOrderHref, formatDateTime } from './utils';

/** 订单状态 → 用户详情里的文案。色调用 STATUS_META 的统一映射。 */
const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  cancelled: '已取消',
  refunded: '已退款',
  partial_refunded: '部分退款',
};

function SpendMetric({
  label,
  value,
  emphasize,
  tone,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  tone?: 'warn' | 'muted';
}) {
  return (
    <div className="min-w-0 px-4 py-3 first:pl-0 last:pr-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-1 text-lg leading-6 font-semibold tabular-nums',
          tone === 'warn'
            ? 'text-warn-text'
            : tone === 'muted'
              ? 'text-muted-foreground'
              : 'text-foreground',
          emphasize && 'text-xl',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * 用户详情中的消费概览。
 *
 * 金额口径与平台概览一致：只统计已支付订单的 `paidCents`，退款取订单上的
 * `refundedCents`（渠道成功后才写回）。处理中的退款单独给一行，避免运营
 * 把「退款中」误读成「已退回」。
 */
export function UserSpendingSection({
  spending,
  orders,
  email,
}: {
  spending: AdminUserSpending;
  orders: AdminUserRecentOrder[];
  email: string;
}) {
  const averageCents =
    spending.paidOrders > 0
      ? Math.round(spending.paidCents / spending.paidOrders)
      : 0;

  return (
    <div data-testid="admin-user-spending">
      <DetailSection
        title="消费"
        note={
          spending.paidOrders > 0
            ? `已支付 ${spending.paidOrders} 笔 · 客单价 ${formatYuan(averageCents)}`
            : '暂无已支付订单'
        }
      >
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <dl className="grid grid-cols-4 divide-x divide-border/70 px-4">
            <SpendMetric
              label="累计实付"
              value={formatYuan(spending.paidCents)}
              emphasize
            />
            <SpendMetric
              label="累计退款"
              value={formatYuan(spending.refundedCents)}
            />
            <SpendMetric
              label="净消费"
              value={formatYuan(spending.netCents)}
              emphasize
            />
            <SpendMetric
              label="退款处理中"
              value={
                spending.refundingCents > 0
                  ? formatYuan(spending.refundingCents)
                  : '—'
              }
              tone={spending.refundingCents > 0 ? 'warn' : 'muted'}
            />
          </dl>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">订单状态</span>
            <span>
              待支付{' '}
              <strong className="font-semibold text-foreground tabular-nums">
                {spending.orderStatus.pending}
              </strong>
            </span>
            <span>
              已支付{' '}
              <strong className="font-semibold text-foreground tabular-nums">
                {spending.orderStatus.paid}
              </strong>
            </span>
            <span>
              部分退款{' '}
              <strong className="font-semibold text-foreground tabular-nums">
                {spending.orderStatus.partialRefunded}
              </strong>
            </span>
            <span>
              已退款{' '}
              <strong className="font-semibold text-foreground tabular-nums">
                {spending.orderStatus.refunded}
              </strong>
            </span>
            <span>
              已取消{' '}
              <strong className="font-semibold text-foreground tabular-nums">
                {spending.orderStatus.cancelled}
              </strong>
            </span>
          </div>
        </div>

        {spending.firstPaidAt || spending.lastPaidAt ? (
          <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <span>
              首次消费{' '}
              <strong className="font-medium text-foreground">
                {formatDateTime(spending.firstPaidAt)}
              </strong>
            </span>
            <span>
              最近消费{' '}
              <strong className="font-medium text-foreground">
                {formatDateTime(spending.lastPaidAt)}
              </strong>
            </span>
          </p>
        ) : null}

        {orders.length === 0 ? (
          <EmptyState
            title="暂无订单"
            description="该用户下单后会显示在这里。"
            className="mt-2 border-0 px-4 py-6"
          />
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-border/70">
            {orders.map((order) => (
              <li key={order.id}>
                <Link
                  className="flex items-center gap-3 rounded-md px-1.5 py-2 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  to={adminOrderDetailHref(order.id)}
                  aria-label={`查看订单 ${order.orderNo}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">
                      {order.itemName ?? '订单'}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                      {order.orderNo}
                    </span>
                  </span>
                  <StatusTag
                    status={order.status}
                    label={ORDER_STATUS_LABEL[order.status] ?? order.status}
                  />
                  <span className="w-20 shrink-0 text-right text-[13px] font-medium tabular-nums text-foreground">
                    {formatYuan(order.paidCents)}
                  </span>
                  <span className="w-32 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    {formatDateTime(order.paidAt ?? order.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2 text-right">
          <Link
            className="text-xs font-medium text-brand hover:underline"
            to={adminOrderHref({ email })}
          >
            查看全部订单
          </Link>
        </div>
      </DetailSection>
    </div>
  );
}
