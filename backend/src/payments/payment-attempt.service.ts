import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { getAdapter } from './adapters';
import { isVisiblePaymentMethod, type ProviderPaymentResult } from './adapters/types';
import { PaymentConfigService } from './payment-config.service';
import type { AttemptContext, PaymentLease } from './payment-order.types';
import { PaymentOrderLifecycleService } from './payment-order-lifecycle.service';
import { PaymentSettlementService } from './payment-settlement.service';

/**
 * 订单的渠道尝试解析与逐个核对。
 *
 * 一个订单可能先后创建过支付宝、微信甚至 PayPal/Stripe 的多条尝试；查单、
 * 关单、重新发起支付都必须逐条确认，不能只信订单上的最后一次渠道。
 */
@Injectable()
export class PaymentAttemptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configs: PaymentConfigService,
    private readonly lifecycle: PaymentOrderLifecycleService,
    private readonly settlement: PaymentSettlementService,
  ) {}

  /** 列出该订单所有可能的渠道尝试。渠道单据 id 不同的尝试不能合并。 */
  async attemptContexts(order: {
    channel: string;
    providerConfigId: string | null;
    providerInstanceId?: string | null;
    checkoutMode: string | null;
    payments: Array<{
      id: string;
      channel: string;
      providerMethod: string | null;
      status: string;
      providerConfigId: string | null;
      providerInstanceId: string | null;
      providerRef: string | null;
      payTransactionId: string | null;
    }>;
  }): Promise<AttemptContext[]> {
    type PaymentRow = (typeof order.payments)[number];
    const unique: PaymentRow[] = [];
    const seen = new Set<string>();

    for (const payment of order.payments) {
      if (!payment.channel || payment.channel === 'free') continue;
      /*
       * PayPal/Stripe 每次 intent 都有独立单据 id，必须逐条核对；只按渠道 + 配置
       * 去重会漏掉更早的 Session。无 providerRef 的 pending 单也不能合并。
       * 只有历史/支付宝/微信这类按商户订单号查询的已结束尝试可按渠道去重。
       */
      const key =
        payment.providerRef || payment.status === 'pending' || !payment.payTransactionId
          ? `${payment.channel}:${payment.providerConfigId ?? 'latest'}:${payment.providerRef ?? payment.id}`
          : `${payment.channel}:${payment.providerConfigId ?? 'latest'}:order`;
      if (seen.has(key)) continue;
      seen.add(key);

      unique.push(payment);
    }

    /*
     * 配置解析互相独立，可以并发；不并发的话，一个挂着多笔渠道尝试的订单
     * 会把查单入口串成 N 次数据库往返。
     */
    const configs = await Promise.all(
      unique.map((payment) =>
        this.configs.resolveForOrder({
          channel: payment.channel,
          providerConfigId: payment.providerConfigId,
          providerInstanceId: payment.providerInstanceId,
        }),
      ),
    );
    const contexts: AttemptContext[] = unique.map((payment, index) => {
      const config = configs[index];
      const adapter = getAdapter(payment.channel);
      if (!config || !adapter) {
        // 不能跳过：跳过会让 close() 误以为所有尝试都已核对完毕
        throw new Error(`支付渠道 ${payment.channel} 的配置不可用`);
      }
      const paymentMethod =
        payment.providerMethod && isVisiblePaymentMethod(payment.providerMethod)
          ? payment.providerMethod
          : payment.channel === 'alipay' || payment.channel === 'wechat'
            ? payment.channel
            : undefined;
      return {
        paymentId: payment.id,
        providerId: config.providerId,
        providerInstanceId: config.instanceId,
        providerRef: payment.providerRef ?? undefined,
        providerTradeNo: payment.payTransactionId ?? undefined,
        config: {
          providerId: config.providerId,
          configId: config.id,
          configVersion: config.version,
          ...(paymentMethod ? { paymentMethod } : {}),
          values: config.values,
        },
        adapter,
      };
    });

    // 历史单没有 Payment 行，但有订单级配置时仍要按订单渠道核对一次
    if (contexts.length === 0 && (order.providerConfigId || order.checkoutMode)) {
      const config = await this.configs.resolveForOrder({
        channel: order.channel,
        providerConfigId: order.providerConfigId,
        providerInstanceId: order.providerInstanceId,
      });
      const adapter = getAdapter(order.channel);
      if (!config || !adapter) throw new Error(`支付渠道 ${order.channel} 的配置不可用`);
      contexts.push({
        paymentId: null,
        providerId: config.providerId,
        providerInstanceId: config.instanceId,
        providerRef: undefined,
        providerTradeNo: undefined,
        config: {
          providerId: config.providerId,
          configId: config.id,
          configVersion: config.version,
          ...(order.channel === 'alipay' || order.channel === 'wechat'
            ? { paymentMethod: order.channel }
            : {}),
          values: config.values,
        },
        adapter,
      });
    }

    return contexts;
  }

  /** 渠道已确认支付：先核对金额/交易号，再走唯一入账入口。 */
  async creditPaidAttempt(
    order: { id: string; orderNo: string; providerTradeNo: string | null },
    attempt: AttemptContext,
    result: ProviderPaymentResult,
    lease: PaymentLease,
  ): Promise<void> {
    if (result.amountCents === undefined) {
      return this.lifecycle.failClose(
        order.id,
        `渠道已支付但未返回金额 (${attempt.providerId})，暂不入账，请人工核对`,
        lease,
      );
    }
    const tradeNo = result.tradeNo ?? order.providerTradeNo ?? '';
    if (!tradeNo) {
      return this.lifecycle.failClose(
        order.id,
        `渠道已支付但未返回交易号 (${attempt.providerId})，暂不入账`,
        lease,
      );
    }

    try {
      await this.settlement.applyPaymentResult({
        orderId: order.id,
        providerId: attempt.providerId,
        configId: attempt.config.configId,
        paymentId: attempt.paymentId ?? undefined,
        providerInstanceId: attempt.providerInstanceId,
        tradeNo,
        amountCents: result.amountCents,
        currency: result.currency ?? 'CNY',
        paidAt: result.paidAt ?? new Date(),
        providerStatus: result.providerStatus,
        rawPayload: result.rawPayload,
        providerRef: attempt.providerRef,
      });
    } catch (e) {
      await this.lifecycle.releaseCloseLease(
        order.id,
        `渠道已支付但入账失败: ${(e as Error).message}`,
        lease,
      );
      throw e;
    }
  }

  /**
   * 重新发起支付前收尾旧 pending 尝试。
   *
   * 先查单再关单：渠道可能已经收款，直接关单会把真实支付误判为未支付。
   * 任一旧尝试无法确认关闭时宁可拒绝创建新支付，也不能留下两个可支付链接。
   */
  async closePendingAttemptsBeforeRetry(
    order: {
      id: string;
      orderNo: string;
      channel: string;
      providerConfigId: string | null;
      providerInstanceId?: string | null;
      providerTradeNo: string | null;
      checkoutMode: string | null;
      payments: Array<{
        id: string;
        channel: string;
        providerMethod: string | null;
        status: string;
        providerConfigId: string | null;
        providerInstanceId: string | null;
        providerRef: string | null;
        payTransactionId: string | null;
      }>;
    },
    intentLeaseAt: Date,
  ): Promise<void> {
    const pendingPayments = order.payments.filter(
      (payment) => payment.status === 'pending' && payment.channel !== 'free',
    );
    if (pendingPayments.length === 0) return;

    let attempts: AttemptContext[];
    try {
      attempts = await this.attemptContexts({ ...order, payments: pendingPayments });
    } catch (e) {
      return this.lifecycle.failClose(
        order.id,
        `旧支付尝试配置不可用，无法确认关闭: ${(e as Error).message}`,
        { intentLeaseAt },
      );
    }

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
          `旧支付尝试查单失败 (${attempt.providerId}): ${(e as Error).message}`,
          { intentLeaseAt },
        );
      }
      if (queried.state === 'paid') {
        await this.creditPaidAttempt(order, attempt, queried, {
          intentLeaseAt,
        });
        throw new AppError(40901, '旧支付尝试已支付，订单已入账，请刷新后查看', 409);
      }
      if (queried.state === 'failed') {
        return this.lifecycle.failClose(
          order.id,
          `旧支付尝试查单失败 (${attempt.providerId}): ${queried.error ?? '未知错误'}`,
          { intentLeaseAt },
        );
      }

      if (queried.state === 'pending') {
        let closed: ProviderPaymentResult;
        try {
          closed = await attempt.adapter.closeOrder(queryInput);
        } catch (e) {
          return this.lifecycle.failClose(
            order.id,
            `旧支付尝试关闭失败 (${attempt.providerId}): ${(e as Error).message}`,
            { intentLeaseAt },
          );
        }
        if (closed.state === 'paid') {
          await this.creditPaidAttempt(order, attempt, closed, {
            intentLeaseAt,
          });
          throw new AppError(40901, '旧支付尝试已支付，订单已入账，请刷新后查看', 409);
        }
        if (closed.state !== 'closed' && closed.state !== 'not_found') {
          return this.lifecycle.failClose(
            order.id,
            `旧支付尝试无法关闭 (${attempt.providerId}): ${closed.error ?? closed.state}`,
            { intentLeaseAt },
          );
        }
      }

      // 渠道明确 closed/not_found，或刚刚关闭成功，才收尾本地尝试。
      await this.lifecycle.closeAttempt(attempt.paymentId);
    }
  }
}
