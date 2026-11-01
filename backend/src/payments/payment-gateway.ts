import { Injectable, Logger } from '@nestjs/common';
import { PaymentConfigService } from './payment-config.service';
import { getAdapter } from './adapters';
import { PaymentContext, RefundInput, RefundResult } from './adapters/types';

/**
 * 订单域访问支付能力的**窄接口**。
 *
 * 为什么需要它：退款由 `OrderService` 发起（状态机与积分回收都在订单域），
 * 但渠道凭据在支付域。直接让 `OrdersModule` import `PaymentsModule` 会形成
 * `PaymentsModule → OrdersModule → PaymentsModule` 的循环。
 *
 * 本类只依赖 `PaymentConfigService`（其依赖只有 Prisma + ConfigModule），
 * 因此可以随 `PaymentCoreModule` 一起被两边安全引用，依赖方向保持单向：
 *
 *   PaymentsModule ─┐
 *                   ├─→ PaymentCoreModule (配置 + 适配器 + 本网关)
 *   OrdersModule ───┘
 */
@Injectable()
export class PaymentGateway {
  private readonly logger = new Logger(PaymentGateway.name);

  constructor(private readonly configs: PaymentConfigService) {}

  /** 订单绑定的渠道配置（历史单回落到同渠道最新版） */
  async contextForOrder(order: {
    channel: string;
    providerConfigId: string | null;
  }): Promise<PaymentContext | null> {
    const config = await this.configs.resolveForOrder(order);
    if (!config) return null;
    return {
      providerId: config.providerId,
      configId: config.id,
      configVersion: config.version,
      values: config.values,
    };
  }

  /**
   * 原路退款。
   *
   * 契约：**不抛异常**，失败一律以 `state:'failed'` 返回，让调用方把退款单
   * 置 failed 并保留「结果未知」语义。凭据缺失同样返回 failed，绝不降级沙箱。
   */
  async refund(input: {
    order: { channel: string; providerConfigId: string | null };
    orderNo: string;
    outRefundNo: string;
    amountCents: number;
    totalCents: number;
    reason?: string;
  }): Promise<RefundResult> {
    const adapter = getAdapter(input.order.channel);
    if (!adapter) return { state: 'failed', error: `未知支付渠道: ${input.order.channel}` };

    let config: PaymentContext | null;
    try {
      config = await this.contextForOrder(input.order);
    } catch (e) {
      return { state: 'failed', error: `支付配置读取失败: ${(e as Error).message}` };
    }
    if (!config) {
      return { state: 'failed', error: `支付渠道 ${input.order.channel} 未完成配置，无法退款` };
    }

    const missing = adapter.validateConfig(config.values);
    if (missing.length > 0) {
      return { state: 'failed', error: `支付渠道 ${input.order.channel} 配置不完整（缺少 ${missing.join(', ')}）` };
    }

    const payload: RefundInput = {
      config,
      orderNo: input.orderNo,
      outRefundNo: input.outRefundNo,
      amountCents: input.amountCents,
      totalCents: input.totalCents,
      reason: input.reason,
    };
    try {
      return await adapter.refund(payload);
    } catch (e) {
      return { state: 'failed', error: `渠道退款调用异常: ${(e as Error).message || e}` };
    }
  }
}
