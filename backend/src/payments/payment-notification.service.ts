import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { PaymentCipher } from './payment-cipher';
import { PaymentConfigService } from './payment-config.service';
import { PaymentOrderService } from './payment-order.service';
import { PaymentExceptionService } from './payment-exception.service';
import { getAdapter } from './adapters';
import { decryptWechatResource } from './adapters/wechat.adapter';
import {
  NotificationResult,
  PaymentAck,
  PaymentAdapter,
  PaymentProviderId,
  VisiblePaymentMethod,
  isVisiblePaymentMethod,
} from './adapters/types';
import type { ResolvedPaymentConfig } from './payment-config.service';

/** 重试退避：1min、5min、15min、1h，最多 8 次 */
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const MAX_ATTEMPTS = 8;

export interface IngestResult {
  ack: PaymentAck;
}

export interface CanonicalNotificationInput {
  providerId: PaymentProviderId;
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
  body: Record<string, unknown>;
}

type VerifiedNotification = Extract<NotificationResult, { ok: true }>;

interface HistoricalPaymentRef {
  providerConfigId: string;
  providerMethod: string | null;
  providerRef: string | null;
  payTransactionId: string | null;
}

interface ResolvedCanonicalCallback {
  config: ResolvedPaymentConfig;
  result: VerifiedNotification;
  expectedPaymentMethod?: VisiblePaymentMethod;
}

interface VerifiedCandidate extends ResolvedCanonicalCallback {
  payments: HistoricalPaymentRef[];
}

const CANONICAL_PROVIDER_IDS: PaymentProviderId[] = ['epay', 'alipay', 'wechat', 'stripe'];

/**
 * 回调收件箱。
 *
 * 顺序不可调换：验签 → 落收件箱 → 同步处理一次 → 回渠道 ack。
 *
 * 为什么先落库再处理：渠道通知是**唯一**能证明「钱到账」的外部事件，
 * 处理过程中进程崩溃时，没有收件箱就只能等渠道重试；有了收件箱，worker
 * 会在重启后补处理。落库前必须验签通过 —— 未验签的报文不能进库，否则
 * 任何人都能往收件箱灌垃圾。
 */
@Injectable()
export class PaymentNotificationService {
  private readonly logger = new Logger(PaymentNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: PaymentCipher,
    private readonly configs: PaymentConfigService,
    private readonly orders: PaymentOrderService,
    private readonly exceptions: PaymentExceptionService,
  ) {}

  /**
   * 旧版带 configId 的回调入口。
   *
   * 历史订单、PayPal/ZPay 等尚未规范化的渠道，以及已写入渠道后台的旧 URL
   * 都继续走这里。新渠道的规范入口见 `ingestCanonical()`。
   */
  async ingest(input: {
    providerId: PaymentProviderId;
    configId: string;
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer;
    body: Record<string, unknown>;
  }): Promise<PaymentAck> {
    const adapter = getAdapter(input.providerId);
    if (!adapter) {
      return {
        status: 404,
        body: JSON.stringify({ code: 'FAIL', message: '未知支付渠道' }),
        contentType: 'application/json; charset=utf-8',
      };
    }

    let config: ResolvedPaymentConfig;
    try {
      config = await this.configs.byId(input.configId);
    } catch {
      return adapter.ack({
        ok: false,
        ackSuccess: false,
        reason: '支付配置不存在',
        rawPayload: '',
      });
    }
    if (config.providerId !== input.providerId) {
      return adapter.ack({
        ok: false,
        ackSuccess: false,
        reason: '回调渠道与配置不匹配',
        rawPayload: '',
      });
    }

    /*
     * 易支付同一套凭据承载支付宝/微信两种支付方式。验签前必须先由
     * 商户订单号定位到当时固化的 Payment，读取 providerMethod 选择期望的
     * type；不能拿渠道配置的当前值或回调 body 里的 type 自证。
     *
     * 定位不到 Payment 或历史记录没有 providerMethod 时直接拒绝，不落收件箱。
     */
    const expectedPaymentMethod =
      input.providerId === 'epay'
        ? await this.expectedPaymentMethodFor(input.body, input.configId)
        : undefined;
    if (input.providerId === 'epay' && !expectedPaymentMethod) {
      this.logger.warn('易支付回调未匹配到已固化支付方式的支付尝试，拒绝落库');
      return adapter.ack({
        ok: false,
        ackSuccess: false,
        reason: '易支付回调未匹配到支付尝试',
        rawPayload: '',
      });
    }

    return this.acceptWithConfig(adapter, config, input, expectedPaymentMethod);
  }

  /**
   * 规范回调入口：URL 不携带 configId，必须从订单引用的历史 Payment 反查
   * 当时的配置版本并逐个验签。绝不能回落到“该渠道最新配置”，否则轮换密钥后
   * 历史订单会验签失败，甚至可能把同一订单串到另一个实例。
   */
  async ingestCanonical(input: CanonicalNotificationInput): Promise<PaymentAck> {
    const adapter = getAdapter(input.providerId);
    if (!adapter) {
      return {
        status: 404,
        body: JSON.stringify({ code: 'FAIL', message: '未知支付渠道' }),
        contentType: 'application/json; charset=utf-8',
      };
    }
    if (!CANONICAL_PROVIDER_IDS.includes(input.providerId)) {
      return adapter.ack({
        ok: false,
        ackSuccess: false,
        reason: '该渠道不支持规范回调地址',
        rawPayload: '',
      });
    }

    let resolved: ResolvedCanonicalCallback;
    try {
      resolved =
        input.providerId === 'wechat'
          ? await this.resolveWechatCanonical(input, adapter)
          : await this.resolvePlainCanonical(input, adapter);
    } catch (e) {
      const message = (e as Error)?.message ?? String(e);
      this.logger.warn(`规范回调未通过安全定位 (${input.providerId}): ${message}`);
      return adapter.ack({
        ok: false,
        ackSuccess: false,
        reason: e instanceof AppError ? message : '回调配置无法安全定位',
        rawPayload: '',
      });
    }

    return this.persistVerified(adapter, resolved.config, input, resolved.result);
  }

  private async acceptWithConfig(
    adapter: PaymentAdapter,
    config: ResolvedPaymentConfig,
    input: CanonicalNotificationInput,
    expectedPaymentMethod?: VisiblePaymentMethod,
  ): Promise<PaymentAck> {
    let result: NotificationResult;
    try {
      result = await adapter.verifyNotification({
        config: this.contextOf(config),
        headers: input.headers,
        rawBody: input.rawBody,
        body: input.body,
        ...(expectedPaymentMethod ? { expectedPaymentMethod } : {}),
      });
    } catch (e) {
      // 验签过程中的异常（解密失败等）同样不能落库，也不能 ack 成功
      this.logger.error(`回调处理异常 (${input.providerId}): ${(e as Error).message}`);
      return adapter.ack({
        ok: false,
        ackSuccess: false,
        reason: '回调处理异常',
        rawPayload: '',
      });
    }

    if (!result.ok) {
      this.logger.warn(`回调未通过 (${input.providerId}): ${result.reason}`);
      return adapter.ack(result);
    }

    return this.persistVerified(adapter, config, input, result);
  }

  /** 验签通过后的唯一落库与同步处理路径。 */
  private async persistVerified(
    adapter: PaymentAdapter,
    config: ResolvedPaymentConfig,
    input: CanonicalNotificationInput,
    result: VerifiedNotification,
  ): Promise<PaymentAck> {
    const digest = sha256(input.rawBody.toString('utf8'));
    const eventId = result.eventId || sha256(`${input.providerId}:${input.rawBody.toString('utf8')}`);

    let row = await this.prisma.paymentNotification.findUnique({
      where: { providerId_providerEventId: { providerId: input.providerId, providerEventId: eventId } },
    });
    if (!row) {
      try {
        row = await this.prisma.paymentNotification.create({
          data: {
            providerId: input.providerId,
            providerEventId: eventId,
            providerConfigId: config.id,
            merchantOrderNo: result.merchantOrderNo,
            payloadDigest: digest,
            payloadCipher: this.cipher.encrypt(input.rawBody.toString('utf8')),
            normalizedJson: JSON.stringify({
              state: result.state,
              providerTradeNo: result.providerTradeNo,
              providerRef: result.providerRef ?? null,
              amountCents: result.amountCents,
              currency: result.currency,
              providerStatus: result.providerStatus,
              paidAt: result.paidAt ? result.paidAt.toISOString() : null,
            }),
            status: 'pending',
          },
        });
      } catch (e) {
        // 并发同一事件：唯一约束冲突后按已存在处理
        if ((e as { code?: string })?.code !== 'P2002') throw e;
        row = await this.prisma.paymentNotification.findUnique({
          where: { providerId_providerEventId: { providerId: input.providerId, providerEventId: eventId } },
        });
      }
    }

    if (row?.status === 'processed') {
      return adapter.ack(result);
    }

    /*
     * 同步处理前先抢占这一行（processing），与 worker 的 `retry()` 抢同一把锁。
     *
     * 不占锁的后果：一条回调在 HTTP 线程处理的同时，worker 每 15 秒的扫描
     * （`status in (pending,failed) && nextAttemptAt <= now`）会把它再处理一遍。
     * 资金侧有 `markPaid` 的条件更新兜底，但 attempts 会虚高、差异记录会重复，
     * 且两条路径可能给出相反的 ack。
     */
    const claimed = await this.prisma.paymentNotification.updateMany({
      where: { id: row!.id, status: { in: ['pending', 'failed'] } },
      data: { status: 'processing', attempts: { increment: 1 } },
    });
    if (claimed.count === 0) {
      const latest = await this.prisma.paymentNotification.findUnique({
        where: { id: row!.id },
        select: { status: true },
      });
      // 已被另一条路径处理完：ack 成功，渠道不必再重试
      if (latest?.status === 'processed') return adapter.ack(result);
      // 另一条路径正在处理同一事件：让渠道稍后重试，绝不能抢先 ack 成功
      return adapter.ack({
        ok: false,
        ackSuccess: false,
        reason: '通知正在处理中',
        rawPayload: '',
      });
    }

    let outcome: { ok: boolean; permanent?: boolean; reason?: string };
    try {
      outcome = await this.processNotification(row!.id, result);
    } catch (e) {
      /*
       * 异常不能把行留在 processing 等 worker 5 分钟后回收：立即退回可重试状态，
       * 同时 ack 失败让渠道也重试一次 —— 两条通道谁先到都能完成入账。
       */
      const message = ((e as Error)?.message ?? String(e)).slice(0, 200);
      this.logger.error(`回调处理异常 (${input.providerId}): ${message}`);
      await this.prisma.paymentNotification
        .update({
          where: { id: row!.id },
          data: { status: 'failed', nextAttemptAt: new Date(), lastError: message },
        })
        .catch(() => undefined);
      return adapter.ack({
        ok: false,
        ackSuccess: false,
        reason: '回调处理异常',
        rawPayload: '',
      });
    }
    if (outcome.ok) return adapter.ack(result);
    if (outcome.permanent) {
      /*
       * 业务终态（订单不存在 / 金额不符 / 配置不匹配）：差异已落对账，
       * 让渠道停止重试。继续 ack failure 只会让渠道反复轰同一条通知，
       * 而本地已经无法通过重试自动修复。
       */
      return adapter.ack({
        ...result,
        ok: true,
        ackSuccess: true,
        reason: outcome.reason ?? '业务终态',
      });
    }
    return adapter.ack({
      ok: false,
      ackSuccess: false,
      reason: outcome.reason ?? '入账失败',
      rawPayload: '',
    });
  }

  private contextOf(config: ResolvedPaymentConfig) {
    return {
      providerId: config.providerId,
      configId: config.id,
      configVersion: config.version,
      values: config.values,
    };
  }

  /**
   * EasyPay / 支付宝 / Stripe 的订单号在明文中。先由订单找到所有历史
   * Payment.providerConfigId，再逐个验签；多个配置同时验签通过且无法用
   * providerRef / 交易号消歧时拒绝。
   */
  private async resolvePlainCanonical(
    input: CanonicalNotificationInput,
    adapter: PaymentAdapter,
  ): Promise<ResolvedCanonicalCallback> {
    const merchantOrderNo = plainCallbackOrderNo(input.providerId, input.body);
    if (!merchantOrderNo) {
      throw new AppError(40001, '回调缺少商户订单号，拒绝处理', 400);
    }
    const providerRef = callbackProviderRef(input.providerId, input.body);
    if ((input.providerId === 'epay' || input.providerId === 'stripe') && !providerRef) {
      throw new AppError(40001, '回调缺少渠道单据号，拒绝处理', 400);
    }

    const order = await this.prisma.order.findUnique({
      where: { orderNo: merchantOrderNo },
      select: { id: true },
    });
    if (!order) throw new AppError(40001, '订单不存在，拒绝处理', 400);

    const loaded = (await this.prisma.payment.findMany({
      where: {
        orderId: order.id,
        channel: input.providerId,
        providerConfigId: { not: null },
      },
      select: {
        providerConfigId: true,
        providerMethod: true,
        providerRef: true,
        payTransactionId: true,
      },
      orderBy: { createdAt: 'asc' },
    })) as Array<HistoricalPaymentRef & { providerConfigId: string | null }>;

    let payments = loaded.filter(
      (payment): payment is HistoricalPaymentRef => Boolean(payment.providerConfigId),
    );
    if (input.providerId === 'epay' || input.providerId === 'stripe') {
      payments = payments.filter((payment) => payment.providerRef === providerRef);
    }
    if (payments.length === 0) {
      throw new AppError(40001, '未找到对应的历史支付尝试，拒绝处理', 400);
    }

    const configs = await this.loadConfigs(
      input.providerId,
      Array.from(new Set(payments.map((payment) => payment.providerConfigId))),
    );
    const successes: VerifiedCandidate[] = [];
    for (const config of configs) {
      const configPayments = payments.filter(
        (payment) => payment.providerConfigId === config.id,
      );
      if (configPayments.length === 0) continue;

      const methods = Array.from(
        new Set(
          configPayments
            .map((payment) => payment.providerMethod)
            .filter((value): value is VisiblePaymentMethod =>
              isVisiblePaymentMethod(value),
            ),
        ),
      );
      if (input.providerId === 'epay' && methods.length !== 1) continue;
      const expectedPaymentMethod = input.providerId === 'epay' ? methods[0] : undefined;

      try {
        const result = await adapter.verifyNotification({
          config: this.contextOf(config),
          headers: input.headers,
          rawBody: input.rawBody,
          body: input.body,
          ...(expectedPaymentMethod ? { expectedPaymentMethod } : {}),
        });
        if (!result.ok || result.merchantOrderNo !== merchantOrderNo) continue;
        successes.push({
          config,
          result,
          payments: configPayments,
          ...(expectedPaymentMethod ? { expectedPaymentMethod } : {}),
        });
      } catch (e) {
        this.logger.warn(
          `规范回调候选配置验签异常 (${input.providerId}/${config.id}): ${(e as Error).message}`,
        );
      }
    }

    return this.chooseUniqueCandidate(input.providerId, successes);
  }

  /**
   * 微信通知正文加密，验签前无法读取订单号：
   *   1. 取所有被 Payment 引用过的微信历史配置；
   *   2. 用各自 APIv3 密钥尝试 AES-GCM 解密；
   *   3. 唯一明文订单号定位订单与历史 Payment；
   *   4. 再用实际配置验签。
   */
  private async resolveWechatCanonical(
    input: CanonicalNotificationInput,
    adapter: PaymentAdapter,
  ): Promise<ResolvedCanonicalCallback> {
    const resource = wechatResourceOf(input.body);
    if (!resource) throw new AppError(40001, '微信回调缺少 resource，拒绝处理', 400);

    const references = (await this.prisma.payment.findMany({
      where: { channel: 'wechat', providerConfigId: { not: null } },
      select: { providerConfigId: true },
      distinct: ['providerConfigId'],
    })) as Array<{ providerConfigId: string | null }>;
    const configIds = references
      .map((reference) => reference.providerConfigId)
      .filter((id): id is string => Boolean(id));
    if (configIds.length === 0) {
      throw new AppError(40001, '微信回调查不到历史支付配置，拒绝处理', 400);
    }

    const configs = await this.loadConfigs('wechat', configIds);
    const decrypted: Array<{ config: ResolvedPaymentConfig; orderNo: string }> = [];
    for (const config of configs) {
      try {
        const payload = decryptWechatResource(config.values.apiV3Key ?? '', resource);
        const orderNo = payload.out_trade_no?.trim() ?? '';
        if (orderNo) decrypted.push({ config, orderNo });
      } catch {
        // 历史配置可能属于其他商户；错误密钥无法通过 GCM 认证，继续尝试下一版。
      }
    }
    if (decrypted.length === 0) {
      throw new AppError(40001, '微信回调无法用历史配置解密，拒绝处理', 400);
    }

    const orderNos = Array.from(new Set(decrypted.map((item) => item.orderNo)));
    if (orderNos.length !== 1) {
      throw new AppError(40001, '微信回调解密出多个商户订单号，拒绝处理', 400);
    }
    const merchantOrderNo = orderNos[0];
    const order = await this.prisma.order.findUnique({
      where: { orderNo: merchantOrderNo },
      select: { id: true },
    });
    if (!order) throw new AppError(40001, '订单不存在，拒绝处理', 400);

    const decryptedConfigIds = Array.from(
      new Set(decrypted.map((item) => item.config.id)),
    );
    const loaded = (await this.prisma.payment.findMany({
      where: {
        orderId: order.id,
        channel: 'wechat',
        providerConfigId: { in: decryptedConfigIds },
      },
      select: {
        providerConfigId: true,
        providerMethod: true,
        providerRef: true,
        payTransactionId: true,
      },
    })) as Array<HistoricalPaymentRef & { providerConfigId: string | null }>;
    const payments = loaded.filter(
      (payment): payment is HistoricalPaymentRef => Boolean(payment.providerConfigId),
    );

    const successes: VerifiedCandidate[] = [];
    for (const item of decrypted) {
      const configPayments = payments.filter(
        (payment) => payment.providerConfigId === item.config.id,
      );
      if (configPayments.length === 0) continue;
      try {
        const result = await adapter.verifyNotification({
          config: this.contextOf(item.config),
          headers: input.headers,
          rawBody: input.rawBody,
          body: input.body,
        });
        if (!result.ok || result.merchantOrderNo !== merchantOrderNo) continue;
        successes.push({
          config: item.config,
          result,
          payments: configPayments,
        });
      } catch (e) {
        this.logger.warn(
          `微信规范回调候选配置验签异常 (${item.config.id}): ${(e as Error).message}`,
        );
      }
    }

    return this.chooseUniqueCandidate('wechat', successes);
  }

  private async loadConfigs(
    providerId: PaymentProviderId,
    configIds: string[],
  ): Promise<ResolvedPaymentConfig[]> {
    const configs: ResolvedPaymentConfig[] = [];
    for (const configId of configIds) {
      try {
        const config = await this.configs.byId(configId);
        if (config.providerId === providerId) configs.push(config);
      } catch (e) {
        this.logger.warn(
          `历史支付配置无法读取 (${providerId}/${configId}): ${(e as Error).message}`,
        );
      }
    }
    return configs;
  }

  private chooseUniqueCandidate(
    providerId: PaymentProviderId,
    successes: VerifiedCandidate[],
  ): ResolvedCanonicalCallback {
    if (successes.length === 0) {
      throw new AppError(40001, '回调未通过任何历史配置验签，拒绝处理', 400);
    }
    if (successes.length === 1) return successes[0];

    /*
     * 配置轮换但凭据未变时，同一通知可能被多个历史版本验签通过。
     * 只有渠道交易号能唯一命中已落库 Payment 时才可以继续；否则必须拒绝，
     * 不能按时间或实例顺序任选一个。
     */
    const byTradeNo = successes.filter(
      (candidate) =>
        Boolean(candidate.result.providerTradeNo) &&
        candidate.payments.some(
          (payment) => payment.payTransactionId === candidate.result.providerTradeNo,
        ),
    );
    if (byTradeNo.length === 1) return byTradeNo[0];
    throw new AppError(
      40001,
      `${providerId} 回调匹配到多个历史支付配置，拒绝处理`,
      400,
    );
  }

  /** worker 重试：claim 成功才处理 */
  async retry(notificationId: string): Promise<'processed' | 'retry' | 'dead'> {
    const now = new Date();
    const claimed = await this.prisma.paymentNotification.updateMany({
      where: {
        id: notificationId,
        status: { in: ['pending', 'failed'] },
        nextAttemptAt: { lte: now },
      },
      data: { status: 'processing', attempts: { increment: 1 } },
    });
    if (claimed.count === 0) return 'retry';

    const row = await this.prisma.paymentNotification.findUnique({ where: { id: notificationId } });
    if (!row) return 'dead';

    let result: NotificationResult;
    try {
      const normalized = JSON.parse(row.normalizedJson || '{}') as {
        state?: string;
        providerTradeNo?: string;
        providerRef?: string | null;
        amountCents?: number;
        currency?: string;
        providerStatus?: string;
        paidAt?: string | null;
      };
      if (normalized.state !== 'paid') {
        await this.markProcessed(notificationId);
        return 'processed';
      }
      result = {
        ok: true,
        eventId: row.providerEventId,
        merchantOrderNo: row.merchantOrderNo,
        providerTradeNo: normalized.providerTradeNo ?? '',
        providerRef: normalized.providerRef ?? undefined,
        amountCents: normalized.amountCents ?? -1,
        currency: (normalized.currency as 'CNY' | 'USD') ?? 'CNY',
        state: 'paid',
        paidAt: normalized.paidAt ? new Date(normalized.paidAt) : new Date(),
        providerStatus: normalized.providerStatus ?? 'SUCCESS',
        ackSuccess: true,
        rawPayload: this.cipher.decrypt(row.payloadCipher),
      };
    } catch (e) {
      await this.markFailed(notificationId, `收件箱数据损坏: ${(e as Error).message}`);
      return 'dead';
    }

    const outcome = await this.processNotification(notificationId, result);
    if (outcome.ok) return 'processed';
    if (outcome.permanent) {
      await this.markFailed(notificationId, outcome.reason ?? '永久失败');
      return 'dead';
    }
    return 'retry';
  }

  // ── 内部 ────────────────────────────────────────────────────────

  /** 易支付回调的先验定位：商户订单号 + 渠道 + 配置版本 → 历史支付方式。 */
  private async expectedPaymentMethodFor(
    body: Record<string, unknown>,
    configId: string,
  ): Promise<VisiblePaymentMethod | null> {
    const merchantOrderNo =
      typeof body.param === 'string' ? body.param.trim() : '';
    if (!merchantOrderNo) return null;

    const order = await this.prisma.order.findUnique({
      where: { orderNo: merchantOrderNo },
      select: { id: true, providerInstanceId: true },
    });
    if (!order) return null;

    const providerRef =
      typeof body.orderId === 'string' ? body.orderId.trim() : '';
    const payment = await this.prisma.payment.findFirst({
      where: {
        orderId: order.id,
        channel: 'epay',
        providerConfigId: configId,
        ...(providerRef ? { providerRef } : {}),
      },
      ...(providerRef ? {} : { orderBy: { createdAt: 'desc' as const } }),
      select: { providerMethod: true },
    });
    return payment?.providerMethod && isVisiblePaymentMethod(payment.providerMethod)
      ? payment.providerMethod
      : null;
  }

  private async processNotification(
    notificationId: string,
    result: Extract<NotificationResult, { ok: true }>,
  ): Promise<{ ok: boolean; permanent?: boolean; reason?: string }> {
    const row = await this.prisma.paymentNotification.findUnique({ where: { id: notificationId } });
    if (!row) return { ok: false, permanent: true, reason: '收件箱记录不存在' };

    if (result.state !== 'paid') {
      // 已确认非成功（用户关单等）：处理完毕，ack 成功让渠道停止重试
      await this.markProcessed(notificationId, { state: result.state });
      return { ok: true };
    }

    const order = await this.prisma.order.findUnique({ where: { orderNo: row.merchantOrderNo } });
    if (!order) {
      await this.recordException({
        providerId: row.providerId,
        merchantOrderNo: row.merchantOrderNo,
        providerTradeNo: result.providerTradeNo,
        amountCents: result.amountCents,
        currency: result.currency,
        result: 'local_order_not_found',
        detail: '渠道回调的商户订单号在本地不存在',
      });
      // 永久失败：本地没有这笔单，重试一万次也不会有
      await this.markFailed(notificationId, '订单不存在');
      return { ok: false, permanent: true, reason: '订单不存在' };
    }

    /*
     * 回调必须能匹配到**任意一次**支付尝试，而不只是订单当前绑定的渠道。
     * 用户可能先发起支付宝、后改选微信；订单上的 channel/config 是最后一次，
     * 但他实际付款的可能是更早那次。只看订单级配置会把已收款回调判成不一致。
     *
     * PayPal/Stripe 在同一订单下会有多个独立渠道单据 id。回调带了
     * providerRef 时必须精确命中对应 Payment，绝不能退化为「同渠道最新一条」，
     * 否则旧 Session 的回调会被记到新 Session 上，查单和退款随后都会串单。
     */
    const providerRef = result.providerRef?.trim() || undefined;
    const attempt = await this.prisma.payment.findFirst({
      where: {
        orderId: order.id,
        channel: row.providerId,
        providerConfigId: row.providerConfigId,
        ...(providerRef ? { providerRef } : {}),
      },
      ...(providerRef ? {} : { orderBy: { createdAt: 'desc' as const } }),
      select: { id: true, providerInstanceId: true },
    });
    if (providerRef && !attempt) {
      const detail = `回调渠道单据号 ${providerRef} 未匹配到支付尝试，禁止回落到最新支付记录`;
      await this.recordException({
        providerId: row.providerId,
        orderId: order.id,
        merchantOrderNo: row.merchantOrderNo,
        providerTradeNo: result.providerTradeNo,
        amountCents: result.amountCents,
        currency: result.currency,
        result: 'credit_failed',
        detail,
      });
      await this.markFailed(notificationId, detail);
      return { ok: false, permanent: true, reason: detail };
    }
    const configMatchesOrder =
      !order.providerConfigId || order.providerConfigId === row.providerConfigId;
    if (!configMatchesOrder && !attempt) {
      await this.recordException({
        providerId: row.providerId,
        orderId: order.id,
        merchantOrderNo: row.merchantOrderNo,
        providerTradeNo: result.providerTradeNo,
        amountCents: result.amountCents,
        currency: result.currency,
        result: 'credit_failed',
        detail: '回调配置版本与订单及其支付尝试均不匹配',
      });
      await this.markFailed(notificationId, '回调配置版本与订单不一致');
      return { ok: false, permanent: true, reason: '回调配置版本与订单不一致' };
    }

    try {
      const providerInstanceId =
        attempt?.providerInstanceId ??
        (await this.configs.byId(row.providerConfigId)).instanceId;
      const applied = await this.orders.applyPaymentResult({
        orderId: order.id,
        providerId: row.providerId as PaymentProviderId,
        configId: row.providerConfigId,
        paymentId: attempt?.id,
        providerInstanceId,
        tradeNo: result.providerTradeNo,
        amountCents: result.amountCents,
        currency: result.currency,
        paidAt: result.paidAt ?? new Date(),
        providerStatus: result.providerStatus,
        rawPayload: result.rawPayload,
        providerRef,
      });
      await this.markProcessed(notificationId, { applied: applied.applied, idempotentHit: applied.idempotentHit });
      await this.prisma.paymentNotification.update({
        where: { id: notificationId },
        data: { orderId: order.id },
      });
      return { ok: true };
    } catch (e) {
      const err = e as AppError;
      const message = err?.message ?? String(e);
      if (err instanceof AppError && err.getStatus() === 409) {
        // 金额/币种/交易号/状态不符：这是业务终态, 必须落差异并让渠道停止重试
        const resultKind = message.includes('金额')
          ? 'amount_mismatch'
          : message.includes('交易号')
            ? 'duplicate_charge'
            : 'credit_failed';
        await this.recordException({
          providerId: row.providerId,
          orderId: order.id,
          merchantOrderNo: row.merchantOrderNo,
          providerTradeNo: result.providerTradeNo,
          amountCents: result.amountCents,
          currency: result.currency,
          result: resultKind,
          detail: message,
        });
        await this.markFailed(notificationId, message);
        return { ok: false, permanent: true, reason: message };
      }
      // 基础设施失败：ack 失败让渠道重试，worker 也会补
      await this.scheduleRetry(notificationId, message);
      return { ok: false, reason: message };
    }
  }

  private async markProcessed(id: string, extra: Record<string, unknown> = {}): Promise<void> {
    const row = await this.prisma.paymentNotification.findUnique({ where: { id } });
    const merged = { ...safeJson(row?.normalizedJson), ...extra };
    await this.prisma.paymentNotification.update({
      where: { id },
      data: {
        status: 'processed',
        processedAt: new Date(),
        lastError: null,
        normalizedJson: JSON.stringify(merged),
      },
    });
  }

  private async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.paymentNotification.update({
      where: { id },
      data: {
        status: 'failed',
        lastError: error.slice(0, 200),
        // 永久失败推到远期, 避免 worker 每 15 秒重试
        nextAttemptAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      },
    });
  }

  private async scheduleRetry(id: string, error: string): Promise<void> {
    const row = await this.prisma.paymentNotification.findUnique({ where: { id } });
    const attempts = row?.attempts ?? 0;
    if (attempts >= MAX_ATTEMPTS) {
      await this.markFailed(id, `重试 ${attempts} 次仍失败: ${error}`);
      return;
    }
    const delay = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
    await this.prisma.paymentNotification.update({
      where: { id },
      data: {
        status: 'failed',
        lastError: error.slice(0, 200),
        nextAttemptAt: new Date(Date.now() + delay),
      },
    });
  }

  /** 回调侧的差异落到新对账体系，让财务在「支付对账」页能看见 */
  private async recordException(input: {
    providerId: string;
    orderId?: string;
    merchantOrderNo: string;
    providerTradeNo: string;
    amountCents: number;
    currency: string;
    result: string;
    detail: string;
  }): Promise<void> {
    try {
      const billDate = shanghaiDate(new Date());
      let run = await this.prisma.paymentReconciliationRun.findFirst({
        where: { providerId: input.providerId, billDate, source: 'notification', status: 'completed' },
        orderBy: { attempt: 'desc' },
      });
      if (!run) {
        const max = await this.prisma.paymentReconciliationRun.aggregate({
          where: { providerId: input.providerId, billDate },
          _max: { attempt: true },
        });
        run = await this.prisma.paymentReconciliationRun.create({
          data: {
            providerId: input.providerId,
            billDate,
            attempt: (max._max.attempt ?? 0) + 1,
            source: 'notification',
            status: 'completed',
            completedAt: new Date(),
            error: null,
          },
        });
      }
      await this.prisma.paymentReconciliationItem.upsert({
        where: {
          runId_merchantOrderNo_providerTradeNo: {
            runId: run.id,
            merchantOrderNo: input.merchantOrderNo,
            providerTradeNo: input.providerTradeNo,
          },
        },
        create: {
          runId: run.id,
          providerId: input.providerId,
          orderId: input.orderId,
          merchantOrderNo: input.merchantOrderNo,
          providerTradeNo: input.providerTradeNo,
          amountCents: input.amountCents,
          currency: input.currency,
          result: input.result,
          detail: input.detail.slice(0, 200),
        },
        update: { result: input.result, detail: input.detail.slice(0, 200) },
      });

      // 对账明细是运行快照；另建不会随下一次运行消失的补偿单。
      // 已取消订单若能精确匹配到成功支付流水，立即尝试原路退款。
      const order = input.orderId
        ? await this.prisma.order.findUnique({ where: { id: input.orderId }, select: { status: true } })
        : await this.prisma.order.findUnique({ where: { orderNo: input.merchantOrderNo }, select: { status: true } });
      if (order?.status === 'cancelled' && input.providerTradeNo) {
        await this.exceptions.autoRefundCancelledPayment({
          providerId: input.providerId,
          merchantOrderNo: input.merchantOrderNo,
          providerTradeNo: input.providerTradeNo,
          amountCents: input.amountCents,
          currency: input.currency,
          detail: input.detail,
        });
      } else {
        await this.exceptions.recordManual({
          providerId: input.providerId,
          orderId: input.orderId,
          merchantOrderNo: input.merchantOrderNo,
          providerTradeNo: input.providerTradeNo,
          amountCents: input.amountCents,
          currency: input.currency,
          kind: input.result,
          detail: input.detail,
        });
      }
      const counts = await this.prisma.paymentReconciliationItem.groupBy({
        by: ['result'],
        where: { runId: run.id },
        _count: { _all: true },
      });
      const total = counts.reduce((sum, c) => sum + c._count._all, 0);
      const matched = counts.find((c) => c.result === 'matched')?._count._all ?? 0;
      const recovered = counts.find((c) => c.result === 'recovered')?._count._all ?? 0;
      await this.prisma.paymentReconciliationRun.update({
        where: { id: run.id },
        data: {
          totalItems: total,
          matchItems: matched,
          recoveredItems: recovered,
          errorItems: total - matched - recovered,
        },
      });
    } catch (e) {
      // 差异落库失败不阻断回调处理, 但必须留日志
      this.logger.error(`回调差异写入失败 (${input.providerId}/${input.merchantOrderNo}): ${(e as Error).message}`);
    }
  }
}

function plainCallbackOrderNo(
  providerId: PaymentProviderId,
  body: Record<string, unknown>,
): string {
  if (providerId === 'epay') return stringOf(body.param);
  if (providerId === 'alipay') return stringOf(body.out_trade_no);
  if (providerId === 'stripe') {
    const session = recordOf(recordOf(body.data)?.object);
    return (
      stringOf(session?.client_reference_id) ||
      stringOf(recordOf(session?.metadata)?.orderNo)
    );
  }
  return '';
}

function callbackProviderRef(
  providerId: PaymentProviderId,
  body: Record<string, unknown>,
): string {
  if (providerId === 'epay') return stringOf(body.orderId);
  if (providerId === 'stripe') return stringOf(recordOf(recordOf(body.data)?.object)?.id);
  return '';
}

function wechatResourceOf(body: Record<string, unknown>): {
  ciphertext: string;
  nonce: string;
  associated_data?: string;
} | null {
  const resource = recordOf(body.resource);
  const ciphertext = stringOf(resource?.ciphertext);
  const nonce = stringOf(resource?.nonce);
  if (!ciphertext || !nonce) return null;
  const associatedData = stringOf(resource?.associated_data);
  return {
    ciphertext,
    nonce,
    ...(associatedData ? { associated_data: associatedData } : {}),
  };
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeJson(value: string | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function shanghaiDate(d: Date): string {
  const shifted = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}`;
}
