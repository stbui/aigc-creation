import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCurrency, ProviderPaymentResult } from './adapters/types';
import { PaymentAttemptService } from './payment-attempt.service';
import type { PaymentActor, PaymentOrderView } from './payment-order.types';
import { truncate } from './payment-order.util';
import { loadPaymentOrder, toPaymentOrderView } from './payment-order.view';
import { PaymentOrderLifecycleService } from './payment-order-lifecycle.service';
import { PaymentSettlementService } from './payment-settlement.service';

/** 查单节流窗口：2 秒内重复查询直接返回本地视图 */
const QUERY_THROTTLE_MS = 2_000;

/** 查单入参。`force` 供用户主动刷新绕过节流。 */
export interface QueryPaymentOrderInput {
  orderId: string;
  actor: PaymentActor;
  /** 用户主动点「刷新支付状态」时绕过 2 秒节流，轮询仍使用节流 */
  force?: boolean;
}

/**
 * 支付状态查单。
 *
 * 只在必要时触达渠道：终态、未发起支付、2 秒节流窗口内都只返回本地视图。
 * 逐条尝试核对，任何一条无法确认关闭都不本地关单。
 */
@Injectable()
export class PaymentQueryService {
  private readonly logger = new Logger(PaymentQueryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attempts: PaymentAttemptService,
    private readonly settlement: PaymentSettlementService,
    private readonly lifecycle: PaymentOrderLifecycleService,
  ) {}

  async query(input: QueryPaymentOrderInput): Promise<PaymentOrderView> {
    const order = await loadPaymentOrder(this.prisma, input.orderId, input.actor);

    if (order.status !== 'pending') return toPaymentOrderView(order);
    if (!order.providerConfigId && !order.checkoutMode) return toPaymentOrderView(order);
    if (
      !input.force &&
      order.lastQueriedAt &&
      Date.now() - order.lastQueriedAt.getTime() < QUERY_THROTTLE_MS
    ) {
      return toPaymentOrderView(order);
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { lastQueriedAt: new Date() },
    });

    let attempts: Awaited<ReturnType<PaymentAttemptService['attemptContexts']>>;
    try {
      attempts = await this.attempts.attemptContexts(order);
    } catch (e) {
      // 配置不可用不能当成「渠道查无此单」；只记录，等运维修复配置
      const message = truncate((e as Error).message, 200);
      await this.prisma.order.update({
        where: { id: order.id },
        data: { lastError: message },
      });
      this.logger.warn(`查单前置检查失败 订单 ${order.orderNo}: ${message}`);
      return toPaymentOrderView(await loadPaymentOrder(this.prisma, order.id, input.actor));
    }
    if (attempts.length === 0) return toPaymentOrderView(order);

    // 只有**所有**尝试都被渠道明确确认关闭，才允许本地关单。
    // not_found 不参与：渠道配置/商户号填错也会返回 not_found，据此关单会漏掉已付款订单。
    let allExplicitlyClosed = true;

    for (const attempt of attempts) {
      let result: ProviderPaymentResult;
      try {
        result = await attempt.adapter.queryOrder({
          config: attempt.config,
          orderNo: order.orderNo,
          providerRef: attempt.providerRef,
          providerTradeNo: attempt.providerTradeNo,
        });
      } catch (e) {
        // 查询失败不改变本地状态，只写 lastError 供排障
        const message = truncate((e as Error).message, 200);
        await this.prisma.order.update({
          where: { id: order.id },
          data: { lastError: message },
        });
        this.logger.warn(`查单失败 订单 ${order.orderNo} (${attempt.providerId}): ${message}`);
        return toPaymentOrderView(await loadPaymentOrder(this.prisma, order.id, input.actor));
      }

      if (result.state === 'paid') {
        try {
          await this.settlement.applyPaymentResult({
            orderId: order.id,
            providerId: attempt.providerId,
            configId: attempt.config.configId,
            paymentId: attempt.paymentId ?? undefined,
            providerInstanceId: attempt.providerInstanceId,
            tradeNo: result.tradeNo ?? '',
            amountCents: result.amountCents ?? -1,
            currency: result.currency ?? (order.currency as PaymentCurrency),
            paidAt: result.paidAt ?? new Date(),
            providerStatus: result.providerStatus,
            rawPayload: result.rawPayload,
            providerRef: attempt.providerRef,
          });
        } catch (e) {
          // 金额/币种/状态不符时保留 pending，交给对账/人工处理，不能静默吞掉
          this.logger.error(`查单入账失败 订单 ${order.id}: ${(e as Error).message}`);
        }
        return toPaymentOrderView(await loadPaymentOrder(this.prisma, order.id, input.actor));
      }

      if (result.state === 'closed') {
        await this.lifecycle.closeAttempt(attempt.paymentId);
        continue;
      }
      if (result.state === 'not_found') {
        allExplicitlyClosed = false;
        continue;
      }
      if (result.state === 'failed') {
        const message = truncate(result.error ?? '查单失败', 200);
        await this.prisma.order.update({
          where: { id: order.id },
          data: { lastError: message },
        });
        return toPaymentOrderView(await loadPaymentOrder(this.prisma, order.id, input.actor));
      }
      // pending：渠道仍在等待支付，不能关单、也不能继续检查别的尝试后下结论
      allExplicitlyClosed = false;
    }

    if (allExplicitlyClosed) await this.lifecycle.localClose(order.id);
    return toPaymentOrderView(await loadPaymentOrder(this.prisma, order.id, input.actor));
  }
}
