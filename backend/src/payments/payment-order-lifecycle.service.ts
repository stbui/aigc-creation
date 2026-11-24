import { Injectable } from '@nestjs/common';
import { lockUserRow } from '../account/user-row-lock';
import { AppError } from '../common/app.exception';
import { SettingsService } from '../common/settings.service';
import type { Prisma } from '../generated/prisma/client';
import { OrderService } from '../orders/order.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PaymentLease } from './payment-order.types';
import { truncate } from './payment-order.util';

/**
 * 订单支付状态的本地终态写入。
 *
 * 只处理「本地怎么落」：置 cancelled、收尾 pending Payment、释放库存与
 * 取消额度、释放租约。渠道查单/关单属于 `PaymentAttemptService`，两者分开
 * 才能让查单、关单、意图流程复用同一套终态写入。
 */
@Injectable()
export class PaymentOrderLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    private readonly settings: SettingsService,
  ) {}

  /** 本地标记单笔支付尝试为 closed；不动订单状态。 */
  async closeAttempt(paymentId: string | null): Promise<void> {
    if (!paymentId) return;
    await this.prisma.payment.updateMany({
      where: { id: paymentId, status: 'pending' },
      data: { status: 'closed', closedAt: new Date() },
    });
  }

  /**
   * 关单失败：保留订单 pending 并释放自己持有的租约，等待下一轮重试。
   * 过期请求不能清掉新请求的租约，也不能覆盖新请求写入的 lastError。
   * 绝不能在这里把订单改成 cancelled —— 渠道可能已收款。
   */
  async failClose(orderId: string, message: string, lease: PaymentLease): Promise<never> {
    const text = truncate(message, 200);
    await this.prisma.order.updateMany({
      where: {
        id: orderId,
        ...(lease.closeLeaseAt
          ? { closeStartedAt: lease.closeLeaseAt }
          : { intentStartedAt: lease.intentLeaseAt }),
      },
      data: {
        lastError: text,
        ...(lease.closeLeaseAt ? { closeStartedAt: null } : {}),
      },
    });
    throw new AppError(50302, text, 503);
  }

  async releaseCloseLease(
    orderId: string,
    message?: string,
    lease: PaymentLease = {},
  ): Promise<void> {
    await this.prisma.order.updateMany({
      where: {
        id: orderId,
        ...(lease.closeLeaseAt
          ? { closeStartedAt: lease.closeLeaseAt }
          : lease.intentLeaseAt
            ? { intentStartedAt: lease.intentLeaseAt }
            : {}),
      },
      data: {
        ...(lease.closeLeaseAt ? { closeStartedAt: null } : {}),
        ...(message ? { lastError: truncate(message, 200) } : {}),
      },
    });
  }

  /**
   * 预留一次用户主动取消额度。
   *
   * 用户行锁把「计数 → 写入预留」串行化，避免并发取消同时读到旧计数。
   * 同一订单已有 reserved/consumed 记录时直接复用，不重复计数。
   */
  async reserveCancelEvent(orderId: string, userId: string): Promise<string | null> {
    const rules = await this.settings.paymentRules();
    if (!rules.cancelLimitEnabled) return null;

    const unitMs = rules.cancelWindowUnit === 'hour' ? 60 * 60_000 : 60_000;
    const windowMs = Math.max(1, rules.cancelWindowSize) * unitMs;
    const now = new Date();
    const fixedWindowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
    const rollingWindowStart = new Date(now.getTime() - windowMs);
    const windowStart = rules.cancelWindowMode === 'fixed' ? fixedWindowStart : now;
    const windowEnd = new Date(windowStart.getTime() + windowMs);

    return this.prisma.$transaction(async (tx) => {
      await lockUserRow(tx, userId);

      const existing = await tx.orderCancelEvent.findUnique({
        where: { orderId },
        select: { id: true, status: true },
      });
      if (existing && (existing.status === 'reserved' || existing.status === 'consumed')) {
        return existing.id;
      }

      const where: Prisma.OrderCancelEventWhereInput = {
        userId,
        status: { in: ['reserved', 'consumed'] },
        NOT: { orderId },
        ...(rules.cancelWindowMode === 'fixed'
          ? { windowStart: fixedWindowStart }
          : { reservedAt: { gte: rollingWindowStart } }),
      };
      const used = await tx.orderCancelEvent.count({ where });
      if (used >= rules.cancelLimitMax) {
        throw new AppError(
          42901,
          `取消订单过于频繁，请稍后再试（${rules.cancelWindowSize} ${rules.cancelWindowUnit === 'hour' ? '小时' : '分钟'}内最多 ${rules.cancelLimitMax} 次）`,
          429,
        );
      }

      if (existing) {
        await tx.orderCancelEvent.update({
          where: { id: existing.id },
          data: {
            status: 'reserved',
            windowMode: rules.cancelWindowMode,
            windowStart,
            windowEnd,
            reservedAt: now,
            consumedAt: null,
            releasedAt: null,
          },
        });
        return existing.id;
      }

      const created = await tx.orderCancelEvent.create({
        data: {
          orderId,
          userId,
          status: 'reserved',
          windowMode: rules.cancelWindowMode,
          windowStart,
          windowEnd,
          reservedAt: now,
        },
        select: { id: true },
      });
      return created.id;
    });
  }

  /** 关单未成功时归还预留额度；已被其他路径消费的记录保持 consumed。 */
  async releaseCancelReservation(eventId: string): Promise<void> {
    await this.prisma.orderCancelEvent.updateMany({
      where: { id: eventId, status: 'reserved' },
      data: { status: 'released', releasedAt: new Date() },
    });
  }

  /**
   * 本地关单：置 cancelled、关闭 pending 尝试、释放库存，全部同一事务。
   *
   * `closeLeaseAt` 是关单租约所有权。传了就只允许持锁者落终态；不传时用于
   * 查单后的关闭和已取消订单修补，要求当前没有并发 intent/close。
   * 对已 cancelled 的订单仍补做支付收尾和库存释放，修复旧版本中断留下的
   * “订单已取消但库存仍占用”状态。
   */
  async localClose(orderId: string, closeLeaseAt?: Date, cancelEventId?: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: {
          id: orderId,
          status: 'pending',
          ...(closeLeaseAt
            ? { closeStartedAt: closeLeaseAt }
            : { closeStartedAt: null, intentStartedAt: null }),
        },
        data: {
          status: 'cancelled',
          closedAt: new Date(),
          closeStartedAt: null,
          intentStartedAt: null,
          checkoutValue: '',
          lastError: null,
        },
      });

      const current = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      if (updated.count === 0 && current?.status !== 'cancelled') return false;

      // 订单关闭后，未完成的支付尝试也必须收尾，否则后台会一直显示 pending。
      await tx.payment.updateMany({
        where: { orderId, status: 'pending' },
        data: { status: 'closed', closedAt: new Date() },
      });
      // 必须复用同一事务，否则进程中断会留下“已取消但库存仍 reserved”。
      await this.orders.releaseReservation(orderId, tx);
      // 只有订单真正落为 cancelled，取消额度才从 reserved 转为 consumed。
      if (cancelEventId) {
        await tx.orderCancelEvent.updateMany({
          where: { id: cancelEventId, orderId, status: 'reserved' },
          data: { status: 'consumed', consumedAt: new Date(), releasedAt: null },
        });
      }
      return true;
    });
  }
}
