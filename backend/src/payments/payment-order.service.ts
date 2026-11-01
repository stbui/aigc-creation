import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { OrderService } from '../orders/order.service';
import { PaymentConfigService } from './payment-config.service';
import { getAdapter } from './adapters';
import {
  PaymentContext,
  PaymentCurrency,
  PaymentProviderId,
  ProviderPaymentResult,
} from './adapters/types';
import { paymentStatusOf } from './payment-query';

export type PaymentActor =
  | { kind: 'user'; userId: string }
  | { kind: 'admin'; adminId: string }
  | { kind: 'worker' };

export interface PaymentIntentView {
  orderId: string;
  orderNo: string;
  amountCents: number;
  currency: string;
  providerId: string;
  configId: string | null;
  configVersion: number | null;
  mode: string;
  payUrl?: string;
  codeUrl?: string;
  checkoutValue: string | null;
  expiresAt: string;
  sandbox: boolean;
  hint?: string | null;
}

export interface PaymentOrderView {
  orderId: string;
  orderNo: string;
  status: string;
  displayStatus: string;
  amountCents: number;
  currency: string;
  providerId: string;
  checkoutMode: string | null;
  checkoutValue: string | null;
  expiresAt: string;
  providerPaidAt: string | null;
  creditedAt: string | null;
  closedAt: string | null;
  lastError: string | null;
  payments: Array<{
    id: string;
    status: string;
    providerId: string;
    providerTradeNo: string | null;
    amountCents: number;
    createdAt: string;
  }>;
}

/** 查单节流窗口：2 秒内重复查询直接返回本地视图 */
const QUERY_THROTTLE_MS = 2_000;

/**
 * 支付编排服务 —— 唯一决定「这笔订单怎么付、付没付、能不能关」的地方。
 *
 * 与旧 `PaymentsService` 的差别：
 *   · 渠道由**数据库配置**决定（多通道并存），不再是单一 env 通道；
 *   · 每次 intent 固定 `providerConfigId/Version`，渠道轮换后历史订单仍可验签；
 *   · 订单状态只经 `OrderService.markPaid` 一条写入路径，本服务不直接写 paid。
 */
@Injectable()
export class PaymentOrderService {
  private readonly logger = new Logger(PaymentOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    private readonly configs: PaymentConfigService,
  ) {}

  /** 渠道异步通知地址：带上 configId，回调才能定位到当时的密钥版本 */
  notifyUrl(providerId: PaymentProviderId, configId: string): string {
    const base = (
      process.env.PAYMENT_NOTIFY_BASE ||
      `http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 4100}`
    ).replace(/\/$/, '');
    return `${base}/api/v1/payments/callback/${providerId}/${configId}`;
  }

  // ── 发起支付 ────────────────────────────────────────────────────

  async createIntent(input: {
    orderId: string;
    userId: string;
    providerId?: string;
  }): Promise<PaymentIntentView> {
    const order = await this.prisma.order.findUnique({
      where: { id: input.orderId },
      include: { items: true },
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);
    if (order.userId !== input.userId) throw new AppError(40301, '无权支付该订单', 403);
    if (order.status === 'paid') throw new AppError(40901, '订单已支付', 409);
    if (order.status !== 'pending') {
      throw new AppError(40901, `订单当前状态不可支付: ${order.status}`, 409);
    }

    const currency = (order.currency || 'CNY') as PaymentCurrency;

    // 0 元单不经任何渠道：渠道既不能收 0 元，也无法回调
    if (order.paidCents <= 0) {
      await this.orders.markPaid({
        orderId: order.id,
        userId: input.userId,
        payTransactionId: `FREE-${order.orderNo}`,
        channel: 'free',
        currency,
        providerStatus: 'FREE',
        providerPaidAt: new Date(),
      });
      return {
        orderId: order.id,
        orderNo: order.orderNo,
        amountCents: 0,
        currency,
        providerId: 'free',
        configId: null,
        configVersion: null,
        mode: 'free',
        checkoutValue: '',
        expiresAt: order.expiresAt.toISOString(),
        sandbox: false,
        hint: '0 元订单已直接完成，无需支付',
      };
    }

    if (order.expiresAt.getTime() <= Date.now()) {
      throw new AppError(40901, '订单已超时关闭', 409);
    }

    const available = await this.configs.available(currency);
    if (available.length === 0) {
      throw new AppError(50301, '当前没有可用的支付渠道，请联系管理员配置', 503);
    }
    let providerId = input.providerId;
    if (!providerId) {
      if (available.length > 1) {
        throw new AppError(40001, '存在多个可用支付渠道，请指定 providerId', 400);
      }
      providerId = available[0].id;
    }
    if (!available.some((p) => p.id === providerId)) {
      throw new AppError(40001, `支付渠道不可用: ${providerId}`, 400);
    }

    const config = await this.configs.latest(providerId as PaymentProviderId);
    if (!config) throw new AppError(50301, '支付渠道未完成配置', 503);
    const adapter = getAdapter(providerId);
    if (!adapter) throw new AppError(40001, `未知支付渠道: ${providerId}`, 400);
    if (!config.enabled) throw new AppError(50301, '支付渠道已停用', 503);
    const missing = adapter.validateConfig(config.values);
    if (missing.length > 0) {
      throw new AppError(50301, `支付渠道未完成配置（缺少 ${missing.join(', ')}）`, 503);
    }

    const context: PaymentContext = {
      providerId: config.providerId,
      configId: config.id,
      configVersion: config.version,
      values: config.values,
    };

    // 同一订单重复发起：旧 pending 尝试先关闭，再创建新尝试
    await this.prisma.payment.updateMany({
      where: { orderId: order.id, status: 'pending' },
      data: { status: 'closed', closedAt: new Date() },
    });

    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        userId: input.userId,
        channel: providerId,
        amountCents: order.paidCents,
        currency,
        status: 'pending',
        providerConfigId: config.id,
        providerConfigVersion: config.version,
      },
    });

    const now = Date.now();
    const expiresAt = new Date(
      Math.min(order.expiresAt.getTime(), now + config.closeAfterMinutes * 60_000),
    );

    try {
      const checkout = await adapter.createOrder({
        config: context,
        orderId: order.id,
        orderNo: order.orderNo,
        amountCents: order.paidCents,
        currency,
        subject: `货觉AI 订单 ${order.orderNo}`,
        returnUrl: `${this.webBase()}/orders`,
        notifyUrl: this.notifyUrl(config.providerId, config.id),
        expiresAt,
      });

      const checkoutValue = checkout.payUrl ?? checkout.codeUrl ?? '';
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          channel: providerId,
          providerConfigId: config.id,
          providerConfigVersion: config.version,
          checkoutMode: checkout.mode,
          checkoutValue,
          checkoutExpiresAt: checkout.expiresAt,
          expiresAt: checkout.expiresAt < order.expiresAt ? checkout.expiresAt : order.expiresAt,
          lastError: null,
          lastQueriedAt: new Date(),
        },
      });

      this.logger.log(
        `发起支付: 订单 ${order.orderNo} 渠道 ${providerId} v${config.version} 金额 ${order.paidCents} 分`,
      );

      return {
        orderId: order.id,
        orderNo: order.orderNo,
        amountCents: order.paidCents,
        currency,
        providerId,
        configId: config.id,
        configVersion: config.version,
        mode: checkout.mode,
        payUrl: checkout.payUrl,
        codeUrl: checkout.codeUrl,
        checkoutValue,
        expiresAt: checkout.expiresAt.toISOString(),
        sandbox: providerId === 'sandbox',
        hint: checkout.hint ?? null,
      };
    } catch (e) {
      const message = truncate((e as Error).message || String(e), 200);
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'failed', lastError: message, message },
      });
      await this.prisma.order.update({
        where: { id: order.id },
        data: { lastError: message, checkoutValue: '' },
      });
      this.logger.error(`发起支付失败 (${providerId}) 订单 ${order.orderNo}: ${message}`);
      throw new AppError(50302, `发起支付失败: ${message}`, 503);
    }
  }

  // ── 查单 ────────────────────────────────────────────────────────

  async query(input: { orderId: string; actor: PaymentActor }): Promise<PaymentOrderView> {
    const order = await this.loadOrder(input.orderId, input.actor);

    if (order.status !== 'pending') return this.view(order);
    if (!order.providerConfigId && !order.checkoutMode) return this.view(order);
    if (order.lastQueriedAt && Date.now() - order.lastQueriedAt.getTime() < QUERY_THROTTLE_MS) {
      return this.view(order);
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { lastQueriedAt: new Date() },
    });

    const config = await this.configs.resolveForOrder({
      channel: order.channel,
      providerConfigId: order.providerConfigId,
    });
    const adapter = getAdapter(order.channel);
    if (!config || !adapter) return this.view(order);

    let result: ProviderPaymentResult;
    try {
      result = await adapter.queryOrder({
        config: {
          providerId: config.providerId,
          configId: config.id,
          configVersion: config.version,
          values: config.values,
        },
        orderNo: order.orderNo,
        providerTradeNo: order.providerTradeNo ?? undefined,
      });
    } catch (e) {
      // 查询失败不改变本地状态，只写 lastError 供排障
      const message = truncate((e as Error).message, 200);
      await this.prisma.order.update({ where: { id: order.id }, data: { lastError: message } });
      this.logger.warn(`查单失败 订单 ${order.orderNo}: ${message}`);
      return this.view(await this.loadOrder(order.id, input.actor));
    }

    await this.applyQueryResult(order.id, config, result);
    return this.view(await this.loadOrder(order.id, input.actor));
  }

  // ── 关单 ────────────────────────────────────────────────────────

  async close(input: { orderId: string; actor: PaymentActor; reason?: string }): Promise<PaymentOrderView> {
    const order = await this.loadOrder(input.orderId, input.actor);
    if (order.status === 'cancelled') return this.view(order);
    if (order.status !== 'pending') {
      throw new AppError(40901, `订单当前状态不可关闭: ${order.status}`, 409);
    }

    // 抢关单租约：条件更新，防止用户手动关单与 worker 同时执行
    const lease = await this.prisma.order.updateMany({
      where: {
        id: order.id,
        status: 'pending',
        OR: [
          { closeStartedAt: null },
          { closeStartedAt: { lte: new Date(Date.now() - 5 * 60_000) } },
        ],
      },
      data: { closeStartedAt: new Date() },
    });
    if (lease.count === 0) return this.view(await this.loadOrder(order.id, input.actor));

    const config = await this.configs.resolveForOrder({
      channel: order.channel,
      providerConfigId: order.providerConfigId,
    });
    const adapter = getAdapter(order.channel);

    // 关单前始终先向渠道查单：已支付的单必须入账，不能借关单把交易记录改成「已取消」
    if (config && adapter && (order.providerConfigId || order.checkoutMode)) {
      const context: PaymentContext = {
        providerId: config.providerId,
        configId: config.id,
        configVersion: config.version,
        values: config.values,
      };
      let queried: ProviderPaymentResult | null = null;
      try {
        queried = await adapter.queryOrder({ config: context, orderNo: order.orderNo });
      } catch (e) {
        this.logger.warn(`关单前查单失败 订单 ${order.orderNo}: ${(e as Error).message}`);
      }

      if (queried?.state === 'paid') {
        await this.applyPaymentResult({
          orderId: order.id,
          providerId: config.providerId,
          configId: config.id,
          tradeNo: queried.tradeNo ?? order.providerTradeNo ?? '',
          amountCents: queried.amountCents ?? order.paidCents,
          currency: queried.currency ?? (order.currency as PaymentCurrency),
          paidAt: queried.paidAt ?? new Date(),
          providerStatus: queried.providerStatus,
          rawPayload: queried.rawPayload,
        });
        throw new AppError(40901, '渠道已支付，订单已入账，请刷新后查看', 409);
      }

      if (queried?.state === 'pending') {
        try {
          await adapter.closeOrder({ config: context, orderNo: order.orderNo });
        } catch (e) {
          const message = truncate((e as Error).message, 200);
          await this.prisma.order.update({
            where: { id: order.id },
            data: { lastError: message, closeStartedAt: null },
          });
          throw new AppError(50302, `渠道关单失败: ${message}`, 503);
        }
      }
    }

    await this.localClose(order.id);
    this.logger.log(`订单已关闭: ${order.orderNo} by ${input.actor.kind}`);
    return this.view(await this.loadOrder(order.id, input.actor));
  }

  // ── 入账（回调 / 查单 / 对账共用）─────────────────────────────────

  async applyPaymentResult(input: {
    orderId: string;
    providerId: PaymentProviderId;
    configId: string;
    tradeNo: string;
    amountCents: number;
    currency: string;
    paidAt: Date;
    providerStatus?: string;
    rawPayload: string;
  }): Promise<{ applied: boolean; idempotentHit: boolean }> {
    const order = await this.prisma.order.findUnique({ where: { id: input.orderId } });
    if (!order) throw new AppError(40400, '订单不存在', 404);

    if (order.status === 'paid') return { applied: false, idempotentHit: true };
    if (order.status !== 'pending') {
      throw new AppError(40901, `订单当前状态不可入账: ${order.status}`, 409);
    }
    if (!input.tradeNo) throw new AppError(40001, '缺少渠道交易号', 400);
    if (input.amountCents !== order.paidCents) {
      throw new AppError(40901, `渠道金额 ${input.amountCents} 分与订单应付 ${order.paidCents} 分不一致`, 409);
    }
    if ((input.currency || 'CNY') !== (order.currency || 'CNY')) {
      throw new AppError(40901, `币种不一致: 渠道 ${input.currency} / 订单 ${order.currency}`, 409);
    }

    const pending = await this.prisma.payment.findFirst({
      where: { orderId: order.id, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const result = await this.orders.markPaid({
      orderId: order.id,
      userId: order.userId,
      payTransactionId: input.tradeNo,
      channel: input.providerId,
      currency: input.currency,
      providerConfigId: input.configId,
      providerStatus: input.providerStatus,
      providerPaidAt: input.paidAt,
      paymentId: pending?.id,
      amountCents: input.amountCents,
      rawPayload: input.rawPayload,
    });

    return { applied: !result.idempotentHit, idempotentHit: result.idempotentHit };
  }

  // ── 视图 ────────────────────────────────────────────────────────

  private async applyQueryResult(
    orderId: string,
    config: { id: string; providerId: PaymentProviderId },
    result: ProviderPaymentResult,
  ): Promise<void> {
    if (result.state === 'paid') {
      await this.applyPaymentResult({
        orderId,
        providerId: config.providerId,
        configId: config.id,
        tradeNo: result.tradeNo ?? '',
        amountCents: result.amountCents ?? -1,
        currency: result.currency ?? 'CNY',
        paidAt: result.paidAt ?? new Date(),
        providerStatus: result.providerStatus,
        rawPayload: result.rawPayload,
      }).catch((e) => {
        this.logger.error(`查单入账失败 订单 ${orderId}: ${(e as Error).message}`);
      });
      return;
    }
    if (result.state === 'closed' || result.state === 'not_found') {
      await this.localClose(orderId);
      return;
    }
    if (result.state === 'failed') {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { lastError: truncate(result.error ?? '查单失败', 200) },
      });
    }
  }

  /** 本地关单：置 cancelled、清空 checkout、释放库存。幂等 */
  private async localClose(orderId: string): Promise<void> {
    const updated = await this.prisma.order.updateMany({
      where: { id: orderId, status: 'pending' },
      data: {
        status: 'cancelled',
        closedAt: new Date(),
        closeStartedAt: null,
        checkoutValue: '',
        lastError: null,
      },
    });
    if (updated.count > 0) {
      await this.orders.releaseReservation(orderId);
    }
  }

  private async loadOrder(orderId: string, actor: PaymentActor) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: { orderBy: { createdAt: 'desc' } } },
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);
    if (actor.kind === 'user' && order.userId !== actor.userId) {
      throw new AppError(40301, '无权查看该订单', 403);
    }
    return order;
  }

  private view(order: {
    id: string;
    orderNo: string;
    status: string;
    paidCents: number;
    currency: string;
    channel: string;
    checkoutMode: string | null;
    checkoutValue: string | null;
    expiresAt: Date;
    providerPaidAt: Date | null;
    paidAt: Date | null;
    closedAt: Date | null;
    lastError: string | null;
    closeStartedAt: Date | null;
    providerConfigId: string | null;
    payments: Array<{
      id: string;
      status: string;
      channel: string;
      payTransactionId: string | null;
      amountCents: number;
      createdAt: Date;
    }>;
  }): PaymentOrderView {
    const displayStatus = paymentStatusOf({
      status: order.status,
      closeStartedAt: order.closeStartedAt,
      lastError: order.lastError,
      providerConfigId: order.providerConfigId,
      checkoutMode: order.checkoutMode,
    });
    const terminal = displayStatus !== 'pending' && displayStatus !== 'created' && displayStatus !== 'closing';
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      status: order.status,
      displayStatus,
      amountCents: order.paidCents,
      currency: order.currency || 'CNY',
      providerId: order.channel,
      checkoutMode: order.checkoutMode,
      checkoutValue: terminal ? '' : order.checkoutValue,
      expiresAt: order.expiresAt.toISOString(),
      providerPaidAt: order.providerPaidAt ? order.providerPaidAt.toISOString() : null,
      creditedAt: order.paidAt ? order.paidAt.toISOString() : null,
      closedAt: order.closedAt ? order.closedAt.toISOString() : null,
      lastError: order.lastError,
      payments: order.payments.map((p) => ({
        id: p.id,
        status: p.status,
        providerId: p.channel,
        providerTradeNo: p.payTransactionId,
        amountCents: p.amountCents,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  private webBase(): string {
    return (process.env.WEB_BASE_URL || 'http://localhost:5100').replace(/\/$/, '');
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
