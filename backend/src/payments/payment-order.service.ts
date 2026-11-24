import { Injectable } from '@nestjs/common';
import type { PaymentProviderId } from './adapters/types';
import { type ClosePaymentOrderInput, PaymentCloseService } from './payment-close.service';
import { type CreatePaymentIntentInput, PaymentIntentService } from './payment-intent.service';
import type { PaymentIntentView, PaymentOrderView } from './payment-order.types';
import { PaymentQueryService, type QueryPaymentOrderInput } from './payment-query.service';
import {
  type ApplyPaymentResultInput,
  PaymentSettlementService,
} from './payment-settlement.service';

export type { PaymentActor, PaymentIntentView, PaymentOrderView } from './payment-order.types';

/**
 * 支付编排服务 —— 唯一决定「这笔订单怎么付、付没付、能不能关」的入口。
 *
 * 与旧 `PaymentsService` 的差别：
 *   · 渠道由**数据库配置**决定（多通道并存），不再是单一 env 通道；
 *   · 每次 intent 固定 `providerConfigId/Version`，渠道轮换后历史订单仍可验签；
 *   · 订单状态只经 `OrderService.markPaid` 一条写入路径，本服务不直接写 paid。
 *
 * 实现按支付生命周期拆开，门面只做委托，保证外部调用方（控制器、worker、
 * 对账、后台）不随内部拆分而改动：
 *
 *   intent      发起支付、回调地址、渠道下单
 *   query       查单与状态视图
 *   close       关单与超时关单
 *   settlement  渠道结果入账
 */
@Injectable()
export class PaymentOrderService {
  constructor(
    private readonly intentFlow: PaymentIntentService,
    private readonly queryFlow: PaymentQueryService,
    private readonly closeFlow: PaymentCloseService,
    private readonly settlement: PaymentSettlementService,
  ) {}

  /** 渠道异步通知地址；没有规范入口的渠道直接拒绝。 */
  notifyUrl(providerId: PaymentProviderId, publicBaseUrl?: string): string {
    return this.intentFlow.notifyUrl(providerId, publicBaseUrl);
  }

  createIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentView> {
    return this.intentFlow.createIntent(input);
  }

  query(input: QueryPaymentOrderInput): Promise<PaymentOrderView> {
    return this.queryFlow.query(input);
  }

  close(input: ClosePaymentOrderInput): Promise<PaymentOrderView> {
    return this.closeFlow.close(input);
  }

  /** 关闭超时未支付订单；所有调度方都必须走这里。 */
  closeExpired(limit?: number): Promise<number> {
    return this.closeFlow.closeExpired(limit);
  }

  /** 渠道结果入账（回调 / 查单 / 对账共用）。 */
  applyPaymentResult(
    input: ApplyPaymentResultInput,
  ): Promise<{ applied: boolean; idempotentHit: boolean }> {
    return this.settlement.applyPaymentResult(input);
  }
}
