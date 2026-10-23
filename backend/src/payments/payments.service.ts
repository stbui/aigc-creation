import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../common/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { OrderService } from '../orders/order.service';
import { PaymentProviderFactory } from './payment.factory';
import {
  PaymentAck,
  PaymentCallbackInput,
  PaymentCallbackResult,
  PaymentChannel,
} from './payment-provider.interface';

/**
 * 支付编排层。
 *
 * 通道层 (providers) 只管协议; 「订单能不能付、钱到账后做什么、钱对不上怎么办」
 * 全部在这里, 且只有一条写入路径: `OrderService.markPaid`。
 *
 * 回调的三道闸 (顺序不可调换):
 *   1. **验签** —— 验不过直接拒, 连报文都不解析 (防止伪造已支付)
 *   2. **金额核对** —— 渠道实收 ≠ 订单应付即落对账差异, **不置 paid**
 *   3. **幂等** —— 交易号唯一 + 订单状态判定, 重复回调不重复发积分
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    private readonly factory: PaymentProviderFactory,
    private readonly config: ConfigService,
  ) {}

  /** 渠道异步通知地址。必须是渠道能访问到的公网地址 */
  notifyUrl(channel: PaymentChannel): string {
    const base = (
      process.env.PAYMENT_NOTIFY_BASE ||
      `http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 4100}`
    ).replace(/\/$/, '');
    return `${base}/api/v1/payments/callback/${channel}`;
  }

  /**
   * 发起支付。
   *
   * 不在这里把订单置为「支付中」: 订单只有 pending/paid 两态, 渠道的预下单
   * 并不改变资金事实。失效由订单自身的 expiresAt 与调度任务兜底。
   */
  async createIntent(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError(40400, '订单不存在', 404);
    if (order.userId !== userId) throw new AppError(40301, '无权支付该订单', 403);
    if (order.status === 'paid') {
      throw new AppError(40901, '订单已支付', 409);
    }
    if (order.status !== 'pending') {
      throw new AppError(40901, `订单当前状态不可支付: ${order.status}`, 409);
    }
    /*
     * 0 元订单（免费体验包 / 100% 优惠）不经任何渠道：渠道既不能收 0 元，
     * 也无法回调。此前这里直接 400，导致这类订单永远到不了 paid —— 页面上的
     * 「免费领取」是死路。直接走同一条 markPaid 入账路径，交易号带 FREE- 前缀，
     * 与真实渠道流水可区分；重复调用由 markPaid 的幂等闸兜住。
     */
    if (order.paidCents <= 0) {
      await this.orders.markPaid({
        orderId: order.id,
        userId,
        payTransactionId: `FREE-${order.orderNo}`,
        channel: 'free',
      });
      return {
        orderId: order.id,
        orderNo: order.orderNo,
        amountCents: 0,
        channel: 'free',
        mode: 'free' as const,
        expiresAt: order.expiresAt,
        hint: '0 元订单已直接完成，无需支付',
        sandbox: false,
      };
    }
    if (new Date() > order.expiresAt) {
      throw new AppError(40901, '订单已超时关闭', 409);
    }

    // 凭据缺失在这里抛 503 (factory.active), 不会降级为沙箱
    const provider = this.factory.active();
    const webBase = (this.config.get<string>('app.webBase') ?? 'http://localhost:5100').replace(
      /\/$/,
      '',
    );

    const intent = await provider.createIntent({
      orderId: order.id,
      orderNo: order.orderNo,
      amountCents: order.paidCents,
      subject: `货觉AI 订单 ${order.orderNo}`,
      returnUrl: `${webBase}/orders`,
      notifyUrl: this.notifyUrl(provider.channel),
    });

    // 订单上的渠道标记与实际发起通道保持一致 (统计与对账都按它分组)
    if (order.channel !== provider.channel) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { channel: provider.channel },
      });
    }

    this.logger.log(
      `发起支付: 订单 ${order.orderNo} 通道 ${provider.channel} 金额 ${order.paidCents} 分`,
    );

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      amountCents: order.paidCents,
      channel: intent.channel,
      mode: intent.mode,
      payUrl: intent.payUrl,
      codeUrl: intent.codeUrl,
      expiresAt: intent.expiresAt,
      hint: intent.hint,
      // 前端据此决定「还在沙箱里」时是否提示用户这不是真实支付
      sandbox: intent.channel === 'sandbox',
    };
  }

  /** 订单支付状态 (前端轮询到已支付即跳成功页) */
  async status(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNo: true, userId: true, status: true, paidCents: true, paidAt: true },
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);
    if (order.userId !== userId) throw new AppError(40301, '无权查看该订单', 403);

    const payments = await this.prisma.payment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      // rawPayload 可能含渠道侧的敏感字段, 一律不返回给前端
      select: {
        id: true,
        channel: true,
        status: true,
        amountCents: true,
        payTransactionId: true,
        paidAt: true,
        createdAt: true,
      },
    });

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      status: order.status,
      paidCents: order.paidCents,
      paidAt: order.paidAt,
      payments,
    };
  }

  /**
   * 处理渠道回调。
   *
   * 返回值直接作为 HTTP 响应 (渠道要求各自的格式: 支付宝纯文本 / 微信 JSON),
   * 因此这里返回 `PaymentAck` 而不是业务对象。
   */
  async handleCallback(channel: string, input: PaymentCallbackInput): Promise<PaymentAck> {
    const provider = this.factory.byChannel(channel);
    const result = await provider.verifyCallback(input);

    if (!result.ok) {
      // 交易状态非成功 (用户关单等) 也走这里: 已经处理完, 回 success 停止重试
      const accepted = result.ackSuccess ?? false;
      const level = accepted ? 'warn' : 'error';
      this.logger[level](`回调未通过 (${channel}): ${result.reason ?? 'unknown'}`);
      return provider.ack(result);
    }

    const { orderNo, tradeNo, amountCents } = result;
    if (!orderNo || !tradeNo || !Number.isInteger(amountCents)) {
      this.logger.error(`回调字段不完整 (${channel}): orderNo=${orderNo} tradeNo=${tradeNo}`);
      return provider.ack({ ...result, ok: false, reason: '回调字段不完整' });
    }

    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) {
      // 渠道收了钱, 本地没有这笔订单 —— 最严重的差异类型, 必须落表并回失败
      await this.recordDiff({
        channel: provider.channel,
        tradeNo,
        channelAmountCents: amountCents,
        diffType: 'missing_local',
        note: `回调的订单号 ${orderNo} 在本地不存在`,
      });
      this.logger.error(`回调订单不存在 (${channel}): ${orderNo} / ${tradeNo}`);
      return provider.ack({ ...result, ok: false, reason: '订单不存在' });
    }

    // 已支付: 幂等确认, 不改任何状态, 也不重复发积分
    if (order.status === 'paid') {
      this.logger.log(`重复回调已忽略: 订单 ${orderNo} 已支付 (${channel})`);
      return provider.ack(result);
    }

    if (order.status !== 'pending') {
      await this.recordDiff({
        channel: provider.channel,
        tradeNo,
        orderId: order.id,
        channelAmountCents: amountCents,
        localAmountCents: order.paidCents,
        diffType: 'amount_mismatch',
        note: `订单状态为 ${order.status} 却收到成功回调`,
      });
      return provider.ack({
        ...result,
        ok: false,
        reason: `订单状态不可支付: ${order.status}`,
      });
    }

    if (amountCents !== order.paidCents) {
      await this.recordDiff({
        channel: provider.channel,
        tradeNo,
        orderId: order.id,
        channelAmountCents: amountCents,
        localAmountCents: order.paidCents,
        diffType: 'amount_mismatch',
        note: '回调金额与订单应付不一致, 订单未置为已支付',
      });
      this.logger.error(
        `回调金额不符 (${channel}) 订单 ${orderNo}: 渠道 ${amountCents} 分, 应付 ${order.paidCents} 分`,
      );
      return provider.ack({ ...result, ok: false, reason: '金额不符' });
    }

    try {
      await this.orders.markPaid({
        orderId: order.id,
        userId: order.userId,
        payTransactionId: tradeNo,
        channel: provider.channel,
        rawPayload: result.raw,
      });
    } catch (e) {
      // 落库失败必须回失败让渠道重试 —— 否则钱收了、单没置 paid, 且不再有人来问
      this.logger.error(`回调入账失败 (${channel}) 订单 ${orderNo}: ${(e as Error).message}`);
      return provider.ack({ ...result, ok: false, reason: '入账失败' });
    }

    this.logger.log(`支付成功 (${channel}): 订单 ${orderNo} 交易号 ${tradeNo}`);
    return provider.ack(result);
  }

  /**
   * 记录一条对账差异 (回调侧)。
   *
   * 自动建一个 `(callback)` 批次, 让回调产生的差异与人工导入的账单差异
   * 在同一处可见 —— 两条来源各自有表的话, 财务要开两个页面才能看全。
   */
  private async recordDiff(params: {
    channel: PaymentChannel;
    tradeNo: string;
    orderId?: string;
    channelAmountCents: number;
    localAmountCents?: number;
    diffType: 'amount_mismatch' | 'missing_local' | 'duplicate';
    note: string;
  }): Promise<void> {
    try {
      const billDate = new Date().toISOString().slice(0, 10);
      let batch = await this.prisma.reconciliationBatch.findFirst({
        where: { channel: params.channel, billDate, fileName: '(callback)' },
      });
      if (!batch) {
        batch = await this.prisma.reconciliationBatch.create({
          data: {
            channel: params.channel,
            billDate,
            fileName: '(callback)',
            status: 'imported',
          },
        });
      }
      await this.prisma.reconciliationItem.create({
        data: {
          batchId: batch.id,
          tradeNo: params.tradeNo,
          orderId: params.orderId,
          diffType: params.diffType,
          channelAmountCents: params.channelAmountCents,
          localAmountCents: params.localAmountCents ?? 0,
          note: params.note,
        },
      });
      await this.prisma.reconciliationBatch.update({
        where: { id: batch.id },
        data: { diffCount: { increment: 1 } },
      });
    } catch (e) {
      // 差异记录失败不阻断回调处理 —— 但必须留下可检索的日志
      this.logger.error(
        `对账差异写入失败 (${params.channel}/${params.tradeNo}): ${(e as Error).message}`,
      );
    }
  }

  /** 通道配置状态 (后台展示) */
  channelStatus() {
    return this.factory.status();
  }
}
