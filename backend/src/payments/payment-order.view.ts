import { AppError } from '../common/app.exception';
import type { PrismaService } from '../prisma/prisma.service';
import { isVisiblePaymentMethod } from './adapters/types';
import type { PaymentActor, PaymentOrderView } from './payment-order.types';
import { paymentStatusOf } from './payment-query';

/**
 * 支付编排的订单读取与对外投影。
 *
 * Prisma include 与字段映射只在这里维护一份：查单、关单、门面都从这里取，
 * 避免同一订单在不同入口返回不同字段。
 */
export async function loadPaymentOrder(
  prisma: PrismaService,
  orderId: string,
  actor: PaymentActor,
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payments: { orderBy: { createdAt: 'desc' } } },
  });
  if (!order) throw new AppError(40400, '订单不存在', 404);
  if (actor.kind === 'user' && order.userId !== actor.userId) {
    throw new AppError(40301, '无权查看该订单', 403);
  }
  return order;
}

/**
 * 真实渠道 → C 端可见支付方式。
 *
 * 易支付是一套凭据承载支付宝/微信，只能在 Payment.providerMethod 已固化时
 * 投影成对应按钮；没有历史支付方式的旧单一律 unknown，不能把 epay 暴露给 C 端。
 */
function visibleProviderId(
  channel: string,
  providerMethod: string | null | undefined,
): PaymentOrderView['providerId'] {
  if (isVisiblePaymentMethod(providerMethod)) return providerMethod;
  if (isVisiblePaymentMethod(channel)) return channel;
  if (channel === 'free') return 'free';
  return 'unknown';
}

export interface PaymentOrderRow {
  id: string;
  orderNo: string;
  status: string;
  paidCents: number;
  currency: string;
  channel: string;
  checkoutMode: string | null;
  checkoutValue: string | null;
  expiresAt: Date;
  providerPaidAt: Date | null;
  paidAt: Date | null;
  closedAt: Date | null;
  lastError: string | null;
  closeStartedAt: Date | null;
  providerConfigId: string | null;
  payments: Array<{
    id: string;
    status: string;
    channel: string;
    providerMethod: string | null;
    providerRef: string | null;
    payTransactionId: string | null;
    amountCents: number;
    createdAt: Date;
  }>;
}

export function toPaymentOrderView(order: PaymentOrderRow): PaymentOrderView {
  const displayStatus = paymentStatusOf({
    status: order.status,
    closeStartedAt: order.closeStartedAt,
    lastError: order.lastError,
    providerConfigId: order.providerConfigId,
    checkoutMode: order.checkoutMode,
  });
  const terminal =
    displayStatus !== 'pending' && displayStatus !== 'created' && displayStatus !== 'closing';
  return {
    orderId: order.id,
    orderNo: order.orderNo,
    status: order.status,
    displayStatus,
    amountCents: order.paidCents,
    currency: order.currency || 'CNY',
    providerId: visibleProviderId(order.channel, order.payments[0]?.providerMethod),
    checkoutMode: order.checkoutMode,
    checkoutValue: terminal ? '' : order.checkoutValue,
    expiresAt: order.expiresAt.toISOString(),
    providerPaidAt: order.providerPaidAt ? order.providerPaidAt.toISOString() : null,
    creditedAt: order.paidAt ? order.paidAt.toISOString() : null,
    closedAt: order.closedAt ? order.closedAt.toISOString() : null,
    lastError: order.lastError,
    payments: order.payments.map((p) => ({
      id: p.id,
      status: p.status,
      providerId: visibleProviderId(p.channel, p.providerMethod),
      providerRef: p.providerRef,
      providerTradeNo: p.payTransactionId,
      amountCents: p.amountCents,
      createdAt: p.createdAt.toISOString(),
    })),
  };
}
