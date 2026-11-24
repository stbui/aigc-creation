import type { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/app.exception';
import type { PrismaService } from '../prisma/prisma.service';

/** 订单状态。cancelled / refunded 是终态, 不可回退 */
export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'refunded' | 'partial_refunded';

/** 允许的状态迁移。key 是当前状态, value 是允许迁移到的状态 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['refunded', 'partial_refunded'],
  partial_refunded: ['refunded', 'partial_refunded'],
  refunded: [],
  cancelled: [],
};

/**
 * 校验并执行状态迁移。非法迁移抛 409, 绝不静默通过。
 *
 * `db` 用于「状态迁移必须与另一处写入同时生效」的场景（退款记账）：
 * 传事务客户端就走同一个事务，否则各自独立提交。
 */
export async function transitionOrder(
  db: Prisma.TransactionClient | PrismaService,
  orderId: string,
  to: OrderStatus,
): Promise<void> {
  /*
   * 取消订单必须经过支付编排层的查单/关单链路。沙箱超时是唯一例外，
   * 由 `cancelSandboxOrder` 在本地原子收尾；这里继续放行会留下
   * “订单已取消但 pending Payment / 库存占用仍在”的脏状态。
   */
  if (to === 'cancelled') {
    throw new AppError(40901, '取消订单必须走支付关单流程，不能直接迁移状态', 409);
  }
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { status: true },
  });
  if (!order) throw new AppError(40400, '订单不存在', 404);

  const allowed = TRANSITIONS[order.status as OrderStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new AppError(
      40901,
      `订单状态不可从 ${order.status} 变更为 ${to} (允许: ${allowed.join('/') || '无'})`,
      409,
    );
  }
  await db.order.update({ where: { id: orderId }, data: { status: to } });
}
