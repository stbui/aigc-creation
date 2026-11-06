import { useEffect, useState } from 'react';
import {
  ActionButton,
  RefreshButton,
  AdminDataTable,
  Descriptions,
  Drawer,
  ListError,
  Notice,
  StatusTag,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { adminPaymentOrdersApi } from './api';
import { CHECKOUT_MODE_LABELS, PAYMENT_STATUS_META, PROVIDER_LABELS } from './constants';
import { moneyText } from './utils';
import type { AdminPaymentOrderDetail } from '../../../types/payment';

type PaymentItem = AdminPaymentOrderDetail['items'][number];
type PaymentAttempt = AdminPaymentOrderDetail['payments'][number];

function paymentItemColumns(currency: string): Array<AdminColumn<PaymentItem>> {
  return [
    { key: 'name', title: '商品', render: (item) => item.name },
    {
      key: 'sku',
      title: 'SKU',
      render: (item) => <code className="font-mono text-xs">{item.sku}</code>,
    },
    {
      key: 'price',
      title: '单价',
      align: 'right',
      render: (item) => <span className="tabular-nums">{moneyText(item.priceCents, currency)}</span>,
    },
    {
      key: 'credits',
      title: '积分',
      align: 'right',
      render: (item) => <span className="tabular-nums">{item.credits}</span>,
    },
    {
      key: 'quantity',
      title: '数量',
      align: 'right',
      render: (item) => <span className="tabular-nums">{item.quantity}</span>,
    },
  ];
}

function paymentAttemptColumns(currency: string): Array<AdminColumn<PaymentAttempt>> {
  return [
    { key: 'status', title: '状态', render: (payment) => payment.status },
    {
      key: 'provider',
      title: '渠道',
      render: (payment) => PROVIDER_LABELS[payment.providerId as keyof typeof PROVIDER_LABELS] ?? payment.providerId,
    },
    {
      key: 'providerRef',
      title: '渠道单据号',
      render: (payment) => <code className="font-mono text-xs break-all">{payment.providerRef ?? '—'}</code>,
    },
    {
      key: 'payTransactionId',
      title: '交易号',
      render: (payment) => <code className="font-mono text-xs">{payment.payTransactionId ?? '—'}</code>,
    },
    {
      key: 'amount',
      title: '金额',
      align: 'right',
      render: (payment) => <span className="tabular-nums">{moneyText(payment.amountCents, currency)}</span>,
    },
    {
      key: 'createdAt',
      title: '创建时间',
      render: (payment) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {payment.createdAt.replace('T', ' ').slice(0, 19)}
        </span>
      ),
    },
  ];
}

/** 支付订单详情抽屉 */
export function PaymentOrderDetailDrawer({
  orderId,
  onClose,
  onChanged,
}: {
  orderId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<AdminPaymentOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminPaymentOrdersApi
      .detail(orderId)
      .then((result) => {
        if (cancelled) return;
        setData(result.order);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, reloadKey]);

  const order = data;

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="支付订单详情"
      description={order?.orderNo}
      width={680}
      footer={
        <div className="flex items-center justify-end gap-2">
          <ActionButton onClick={onClose}>关闭</ActionButton>
        </div>
      }
    >
      {loading && !order ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : error && !order ? (
        <ListError error={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : order ? (
        <div className="flex flex-col gap-4">
          {order.lastError && (
            <Notice tone="danger" title="失败原因">
              {order.lastError}
            </Notice>
          )}

          <Descriptions
            columns={2}
            items={[
              { label: '订单号', value: <code className="font-mono text-xs">{order.orderNo}</code> },
              { label: '用户', value: order.user ? order.user.name || order.user.email : '用户不存在' },
              { label: '邮箱', value: order.user?.email ?? '—' },
              {
                label: '用户 ID',
                value: <code className="font-mono text-xs break-all">{order.userId}</code>,
              },
              { label: '商品', value: order.productName },
              {
                label: '支付渠道',
                value: `${PROVIDER_LABELS[order.providerId as keyof typeof PROVIDER_LABELS] ?? order.providerId}（${CHECKOUT_MODE_LABELS[order.checkout.mode ?? ''] ?? order.checkout.mode ?? '—'}）`,
              },
              {
                label: '金额',
                value: <span className="tabular-nums">{moneyText(order.amountCents, order.currency)}</span>,
              },
              {
                label: '权益',
                value: `${order.credits.toLocaleString('zh-CN')} 积分`,
              },
              {
                label: '状态',
                value: (
                  <StatusTag
                    status={order.status}
                    tone={PAYMENT_STATUS_META[order.status]?.tone ?? 'muted'}
                    label={PAYMENT_STATUS_META[order.status]?.label ?? order.status}
                  />
                ),
              },
              {
                label: '渠道交易号',
                value: <code className="font-mono text-xs">{order.providerTradeNo ?? '—'}</code>,
              },
              {
                label: '渠道单据号',
                value: <code className="font-mono text-xs break-all">{order.providerRef ?? '—'}</code>,
              },
              {
                label: '配置版本',
                value: order.providerConfigVersion === null ? '—' : `v${order.providerConfigVersion}`,
              },
              { label: '创建时间', value: order.createdAt.replace('T', ' ').slice(0, 19) },
              { label: '过期时间', value: order.expiresAt.replace('T', ' ').slice(0, 19) },
              {
                label: '支付时间',
                value: order.providerPaidAt ? order.providerPaidAt.replace('T', ' ').slice(0, 19) : '—',
              },
              {
                label: '入账时间',
                value: order.creditedAt ? order.creditedAt.replace('T', ' ').slice(0, 19) : '—',
              },
              {
                label: '关闭时间',
                value: order.closedAt ? order.closedAt.replace('T', ' ').slice(0, 19) : '—',
              },
            ]}
          />

          {order.items.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-foreground">商品明细</span>
              <div className="overflow-hidden rounded-lg border border-border">
                <AdminDataTable<PaymentItem>
                  rows={order.items}
                  columns={paymentItemColumns(order.currency)}
                  rowKey={(item) => item.id}
                  density="compact"
                  emptyText="没有商品明细。"
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-foreground">支付尝试记录</span>
            {order.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无支付尝试</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <AdminDataTable<PaymentAttempt>
                  rows={order.payments}
                  columns={paymentAttemptColumns(order.currency)}
                  rowKey={(payment) => payment.id}
                  density="compact"
                  emptyText="暂无支付尝试"
                />
              </div>
            )}
          </div>

          <Notice tone="info" title="退款请到订单管理">
            本页不提供退款操作。退款会动积分与优惠券回滚，统一在订单管理执行。
          </Notice>

          <div className="flex justify-end">
            <RefreshButton
              variant="default"
              onRefresh={() => {
                setReloadKey((k) => k + 1);
                onChanged();
              }}
            />
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}
