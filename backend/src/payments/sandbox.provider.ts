import { Logger } from '@nestjs/common';
import {
  PaymentAck,
  PaymentCallbackInput,
  PaymentCallbackResult,
  PaymentChannel,
  PaymentIntentInput,
  PaymentIntentResult,
  PaymentProvider,
  PaymentRefundInput,
  PaymentRefundResult,
} from './payment-provider.interface';

/**
 * 沙箱通道 —— 零凭据、零网络, 用于本地开发与冒烟测试。
 *
 * 发起支付不产生任何外部请求: 前端按 mode='sandbox' 走站内模拟页
 * (`POST /orders/:id/pay`, 三场景 success/failed/timeout)。
 *
 * ⚠ 回调只在**非生产环境**接受。生产环境若仍留在沙箱通道,
 * 任何知道订单号的人都能伪造一条「已支付」回调白拿积分 —— 这不是
 * 「功能缺失」而是资损漏洞, 所以宁可让回调直接失败。
 */
export class SandboxPaymentProvider implements PaymentProvider {
  readonly channel: PaymentChannel = 'sandbox';
  private readonly logger = new Logger(SandboxPaymentProvider.name);

  private get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  isConfigured(): boolean {
    return true;
  }

  missingConfig(): string[] {
    return [];
  }

  async createIntent(input: PaymentIntentInput): Promise<PaymentIntentResult> {
    return {
      channel: 'sandbox',
      mode: 'sandbox',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      hint:
        `沙箱通道: 请调用 POST /orders/${input.orderId}/pay 并传入 ` +
        `scenario=success|failed|timeout 模拟支付结果`,
    };
  }

  /**
   * 沙箱退款: 零网络, 直接成功。
   *
   * `providerRefundId` 留空 —— 沙箱没有外部退款单号, 造一个假的会让
   * 「这笔钱确实原路退回」看起来有凭据。真实通道必须有该字段。
   */
  async refund(input: PaymentRefundInput): Promise<PaymentRefundResult> {
    this.logger.log(`沙箱退款: ${input.orderNo} / ${input.outRefundNo} ${input.amountCents} 分`);
    return { state: 'succeeded', raw: JSON.stringify({ sandbox: true, ...input }) };
  }

  async verifyCallback(input: PaymentCallbackInput): Promise<PaymentCallbackResult> {
    if (this.isProduction) {
      const reason = '沙箱通道在生产环境不接收回调 (存在伪造支付风险)';
      this.logger.error(reason);
      return { ok: false, reason, raw: input.rawBody };
    }

    const body = input.body ?? {};
    const orderNo = typeof body.orderNo === 'string' ? body.orderNo : undefined;
    const tradeNo = typeof body.tradeNo === 'string' ? body.tradeNo : undefined;
    const amount = Number(body.amountCents);

    if (!orderNo) return { ok: false, reason: '缺少 orderNo', raw: input.rawBody };
    if (!tradeNo) return { ok: false, reason: '缺少 tradeNo', raw: input.rawBody };
    if (!Number.isInteger(amount) || amount < 0) {
      return { ok: false, reason: 'amountCents 必须是非负整数', raw: input.rawBody };
    }

    return {
      ok: true,
      orderNo,
      tradeNo,
      amountCents: amount,
      paidAt: new Date(),
      raw: input.rawBody,
    };
  }

  ack(result: PaymentCallbackResult): PaymentAck {
    const accepted = result.ackSuccess ?? result.ok;
    return {
      status: accepted ? 200 : 400,
      body: JSON.stringify({ success: accepted, reason: result.reason ?? null }),
      contentType: 'application/json; charset=utf-8',
    };
  }
}
