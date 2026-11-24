import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app.exception';
import { OrderService } from '../orders/order.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PaymentProviderId, VisiblePaymentMethod } from './adapters/types';

export interface ApplyPaymentResultInput {
  orderId: string;
  providerId: PaymentProviderId;
  configId: string;
  providerConfigVersion?: number;
  paymentMethod?: VisiblePaymentMethod;
  tradeNo: string;
  amountCents: number;
  currency: string;
  paidAt: Date;
  providerStatus?: string;
  rawPayload: string;
  /** 渠道侧下单单据 id；由已知的支付尝试或回调报文带入 */
  providerRef?: string;
  /** 调用方已定位到的支付尝试；不传则按渠道取最新 pending */
  paymentId?: string;
  /** 本次实际入账的服务商实例；不传时从支付尝试或订单恢复 */
  providerInstanceId?: string;
}

/**
 * 渠道结果入账（回调 / 查单 / 对账共用）。
 *
 * 本服务只做「渠道流水 → 订单」这一跳，并保证归属可判定；真正的入账、
 * 发积分、激活会员仍走唯一的 `OrderService.markPaid`。
 */
@Injectable()
export class PaymentSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
  ) {}

  async applyPaymentResult(
    input: ApplyPaymentResultInput,
  ): Promise<{ applied: boolean; idempotentHit: boolean }> {
    const order = await this.prisma.order.findUnique({
      where: { id: input.orderId },
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);

    if (order.status === 'paid') {
      /*
       * 只有**同一个渠道交易号**才是幂等重放。
       *
       * 已支付订单收到另一个交易号，说明渠道侧发生了第二笔成功扣款（旧链接
       * 未关干净、用户重复支付等）。旧实现直接按幂等成功返回，第二笔钱既
       * 不落 Payment 也不落异常单；若渠道不支持对账就完全不可见。
       *
       * 这里抛 409，让回调收件箱把差异落到 PaymentExceptionCase；真正的
       * 同号重复回调仍走幂等，不会影响渠道重试。
       */
      const knownTradeNo = order.providerTradeNo ?? '';
      if (input.tradeNo && knownTradeNo && input.tradeNo !== knownTradeNo) {
        const samePayment = await this.prisma.payment.findUnique({
          where: { payTransactionId: input.tradeNo },
          select: { orderId: true },
        });
        if (samePayment?.orderId !== order.id) {
          throw new AppError(
            40901,
            `订单已支付，渠道交易号 ${input.tradeNo} 与已入账交易号 ${knownTradeNo} 不一致`,
            409,
          );
        }
      }
      return { applied: false, idempotentHit: true };
    }
    if (order.status !== 'pending') {
      throw new AppError(40901, '订单状态已变化，无法入账，请刷新后重试', 409);
    }
    if (!input.tradeNo) throw new AppError(40001, '缺少渠道交易号', 400);
    if (input.amountCents !== order.paidCents) {
      throw new AppError(
        40901,
        `渠道金额 ${input.amountCents} 分与订单应付 ${order.paidCents} 分不一致`,
        409,
      );
    }
    if ((input.currency || 'CNY') !== (order.currency || 'CNY')) {
      throw new AppError(40901, `币种不一致: 渠道 ${input.currency} / 订单 ${order.currency}`, 409);
    }

    // 只更新**同一渠道**的 pending 尝试；否则跨渠道重试时会把另一笔尝试
    // 改成本次渠道的交易号，后台支付尝试记录会张冠李戴。
    //
    // 对账补单等调用方可能无法提供 paymentId。此时只有在候选唯一时才能
    // 自动归属；同一订单在同一渠道/实例下有多条 pending 尝试时，任何
    // “取最新一条”都会把成功流水挂到错误单据上，必须转人工确认。
    let pendingAttempts: Array<{ id: string; providerInstanceId: string | null }> = [];
    if (!input.paymentId) {
      pendingAttempts = await this.prisma.payment.findMany({
        where: {
          orderId: order.id,
          status: 'pending',
          channel: input.providerId,
          ...(input.providerInstanceId ? { providerInstanceId: input.providerInstanceId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, providerInstanceId: true },
      });
      if (pendingAttempts.length > 1) {
        throw new AppError(
          40901,
          `订单存在多条待支付尝试（${pendingAttempts.length} 条），无法确定本次渠道流水归属，请人工核对`,
          409,
        );
      }
    }
    const attempt = input.paymentId ?? pendingAttempts[0];
    const paymentId = typeof attempt === 'string' ? attempt : attempt?.id;
    const providerInstanceId =
      input.providerInstanceId ??
      (typeof attempt === 'string' ? undefined : attempt?.providerInstanceId) ??
      order.providerInstanceId ??
      undefined;

    const result = await this.orders.markPaid({
      orderId: order.id,
      userId: order.userId,
      payTransactionId: input.tradeNo,
      channel: input.providerId,
      currency: input.currency,
      providerConfigId: input.configId,
      providerConfigVersion: input.providerConfigVersion,
      providerMethod: input.paymentMethod,
      providerInstanceId,
      providerStatus: input.providerStatus,
      providerPaidAt: input.paidAt,
      paymentId,
      amountCents: input.amountCents,
      rawPayload: input.rawPayload,
      providerRef: input.providerRef,
    });

    return {
      applied: !result.idempotentHit,
      idempotentHit: result.idempotentHit,
    };
  }
}
