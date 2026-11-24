import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../common/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderPaymentResult } from './adapters/types';
import { PaymentAttemptService } from './payment-attempt.service';
import type { PaymentActor, PaymentOrderView } from './payment-order.types';
import { loadPaymentOrder, toPaymentOrderView } from './payment-order.view';
import { PaymentOrderLifecycleService } from './payment-order-lifecycle.service';

/** 租约失联判定：超过该时长未续期的关单/发起支付租约可被接管 */
const STALE_LEASE_MS = 5 * 60_000;

/** 关单入参。actor 决定是否计入用户取消额度。 */
export interface ClosePaymentOrderInput {
  orderId: string;
  actor: PaymentActor;
}

/**
 * 关单编排。
 *
 * 关单前必须逐个渠道尝试查单：渠道可能已收款，直接本地置 cancelled 会造成
 * 「已收款不入账」。任一尝试无法确认关闭时保留 pending 并释放自己的租约。
 */
@Injectable()
export class PaymentCloseService {
  private readonly logger = new Logger(PaymentCloseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attempts: PaymentAttemptService,
    private readonly lifecycle: PaymentOrderLifecycleService,
  ) {}

  async close(input: ClosePaymentOrderInput): Promise<PaymentOrderView> {
    const order = await loadPaymentOrder(this.prisma, input.orderId, input.actor);
    if (order.status === 'cancelled') {
      // 幂等修补历史中断：即使已取消，也补做 pending 支付收尾与库存释放。
      await this.lifecycle.localClose(order.id);
      return toPaymentOrderView(await loadPaymentOrder(this.prisma, order.id, input.actor));
    }
    if (order.status !== 'pending') {
      throw new AppError(40901, '订单状态已变化，无法关闭，请刷新后重试', 409);
    }

    const closeLeaseAt = new Date();
    const staleLeaseBefore = new Date(Date.now() - STALE_LEASE_MS);

    /*
     * 抢关单租约：除了防止用户手动关单与 worker 同时执行，还必须与
     * createIntent 的租约互斥。否则关单读取完旧 Payment 后，另一请求可能
     * 新建渠道订单；旧关单随后只关闭了快照中的旧尝试并取消本地订单，
     * 新渠道链接仍可付款。
     */
    const lease = await this.prisma.order.updateMany({
      where: {
        id: order.id,
        status: 'pending',
        AND: [
          {
            OR: [{ closeStartedAt: null }, { closeStartedAt: { lte: staleLeaseBefore } }],
          },
          {
            OR: [{ intentStartedAt: null }, { intentStartedAt: { lte: staleLeaseBefore } }],
          },
        ],
      },
      data: { closeStartedAt: closeLeaseAt },
    });
    if (lease.count === 0)
      return toPaymentOrderView(await loadPaymentOrder(this.prisma, order.id, input.actor));

    /*
     * 取消频率额度必须在拿到关单租约之后、查单之前预留。
     * 先抢租约可避免同一订单的并发取消重复占额度；额度不足时只需释放租约，
     * 不应向渠道发起任何查单/关单请求。
     */
    let cancelEventId: string | null = null;
    if (input.actor.kind === 'user') {
      try {
        cancelEventId = await this.lifecycle.reserveCancelEvent(order.id, input.actor.userId);
      } catch (e) {
        await this.lifecycle.releaseCloseLease(order.id, undefined, {
          closeLeaseAt,
        });
        throw e;
      }
    }

    let cancelFinalized = false;
    try {
      // 抢到租约后必须重读：等待租约期间可能刚有支付尝试落库。
      const fresh = await loadPaymentOrder(this.prisma, order.id, input.actor);
      let attempts: Awaited<ReturnType<PaymentAttemptService['attemptContexts']>>;
      try {
        attempts = await this.attempts.attemptContexts(fresh);
      } catch (e) {
        return this.lifecycle.failClose(
          order.id,
          `支付配置不可用，无法查单/关单: ${(e as Error).message}`,
          { closeLeaseAt },
        );
      }

      // 从未发起过支付的空单：本地关闭即可
      if (attempts.length === 0) {
        cancelFinalized = await this.lifecycle.localClose(
          order.id,
          closeLeaseAt,
          cancelEventId ?? undefined,
        );
        this.logger.log(`订单已关闭: ${order.orderNo} by ${input.actor.kind}`);
        return toPaymentOrderView(await loadPaymentOrder(this.prisma, order.id, input.actor));
      }

      /*
       * 关单前必须逐个尝试验证：渠道查询/关单任一步失败都不能本地关单。
       * 否则「渠道暂时不可达」会被误判成「渠道没收到钱」，用户随后仍能支付，
       * 而回调到达时订单已是 cancelled，直接变成已收款不入账。
       */
      for (const attempt of attempts) {
        const queryInput = {
          config: attempt.config,
          orderNo: order.orderNo,
          providerRef: attempt.providerRef,
          providerTradeNo: attempt.providerTradeNo,
        };

        let queried: ProviderPaymentResult;
        try {
          queried = await attempt.adapter.queryOrder(queryInput);
        } catch (e) {
          return this.lifecycle.failClose(
            order.id,
            `关单前查单失败 (${attempt.providerId}): ${(e as Error).message}`,
            { closeLeaseAt },
          );
        }

        if (queried.state === 'paid') {
          await this.attempts.creditPaidAttempt(order, attempt, queried, {
            closeLeaseAt,
          });
          throw new AppError(40901, '渠道已支付，订单已入账，请刷新后查看', 409);
        }
        if (queried.state === 'failed') {
          return this.lifecycle.failClose(
            order.id,
            `关单前查单失败 (${attempt.providerId}): ${queried.error ?? '未知错误'}`,
            { closeLeaseAt },
          );
        }

        if (queried.state === 'pending') {
          let closed: ProviderPaymentResult;
          try {
            closed = await attempt.adapter.closeOrder(queryInput);
          } catch (e) {
            return this.lifecycle.failClose(
              order.id,
              `渠道关单失败 (${attempt.providerId}): ${(e as Error).message}`,
              { closeLeaseAt },
            );
          }
          if (closed.state === 'paid') {
            await this.attempts.creditPaidAttempt(order, attempt, closed, {
              closeLeaseAt,
            });
            throw new AppError(40901, '渠道已支付，订单已入账，请刷新后查看', 409);
          }
          if (closed.state !== 'closed' && closed.state !== 'not_found') {
            return this.lifecycle.failClose(
              order.id,
              `渠道关单未成功 (${attempt.providerId}): ${closed.error ?? closed.state}`,
              { closeLeaseAt },
            );
          }
        }

        await this.lifecycle.closeAttempt(attempt.paymentId);
      }

      cancelFinalized = await this.lifecycle.localClose(
        order.id,
        closeLeaseAt,
        cancelEventId ?? undefined,
      );
      this.logger.log(`订单已关闭: ${order.orderNo} by ${input.actor.kind}`);
      return toPaymentOrderView(await loadPaymentOrder(this.prisma, order.id, input.actor));
    } finally {
      if (cancelEventId && !cancelFinalized) {
        await this.lifecycle.releaseCancelReservation(cancelEventId);
      }
    }
  }

  /**
   * 关闭超时未支付订单。所有调用方（旧调度器 / 支付 worker）都必须走这里，
   * 不能自己 `updateMany({status:'cancelled'})` —— 那会绕过渠道查单与库存释放。
   */
  async closeExpired(limit = 50): Promise<number> {
    const expired = await this.prisma.order.findMany({
      where: {
        status: 'pending',
        expiresAt: { lte: new Date() },
        OR: [
          { closeStartedAt: null },
          { closeStartedAt: { lte: new Date(Date.now() - STALE_LEASE_MS) } },
        ],
      },
      take: limit,
      select: { id: true },
    });

    let closed = 0;
    for (const item of expired) {
      try {
        const view = await this.close({
          orderId: item.id,
          actor: { kind: 'worker' },
        });
        if (view.status === 'cancelled') closed += 1;
      } catch (e) {
        // 已支付会抛 409，属正常竞态；其它错误留给下一轮重试
        this.logger.warn(`关闭超时订单 ${item.id} 未完成: ${(e as Error).message}`);
      }
    }
    return closed;
  }
}
