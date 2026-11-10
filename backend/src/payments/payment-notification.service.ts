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
  id: string;
  providerConfigId: string | null;
  providerInstanceId: string | null;
  providerMethod: string | null;
  providerRef: string | null;
  payTransactionId: string | null;
  status: string;
  createdAt: Date;
}

interface PaymentAttemptRef extends HistoricalPaymentRef {
  orderId: string;
  channel: string;
  providerConfigVersion: number | null;
}

interface ResolvedHistoricalPayment {
  payment: HistoricalPaymentRef;
  config: ResolvedPaymentConfig;
}

interface ResolvedCanonicalCallback {
  config: ResolvedPaymentConfig;
  result: VerifiedNotification;
  expectedPaymentMethod?: VisiblePaymentMethod;
  /** 验签后精确定位的 Payment，用于把历史空配置/空支付方式回填。 */
  payment?: HistoricalPaymentRef;
}

interface NotificationMetadata {
  paymentId?: string;
  providerConfigVersion?: number;
  providerInstanceId?: string;
  expectedPaymentMethod?: VisiblePaymentMethod;
}

interface PaymentAttemptResolution {
  payment?: PaymentAttemptRef;
  error?: string;
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
   * 都继续走这里。前置定位（byId + providerId 匹配）与规范入口不同，定位完成后
   * 委托给 `ingestCanonical()` 的 legacy 分支，共用同一条验签 / 落库 / ack 链路。
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

    // 传 config 走 legacy 分支：这些渠道不在规范白名单里，且 configId 已经是
    // 精确定位结果，再走历史反查反而可能把同一订单串到另一个配置实例。
    return this.ingestCanonical(
      {
        providerId: input.providerId,
        headers: input.headers,
        rawBody: input.rawBody,
        body: input.body,
      },
      config,
    );
  }

  /**
   * EasyPay 旧版入口。
   *
   * 商户订单号 + 固定配置 + 渠道单据号必须先精确定位到历史上的 Payment。
   * 历史行的 providerMethod 可能为空，此时仅用 alipay/wechat 分别验签，
   * 由参与 MD5 的 type 决定哪个成功；绝不直接信任回调 body.type。
   */
  private async acceptEpayWithConfig(
    adapter: PaymentAdapter,
    config: ResolvedPaymentConfig,
    input: CanonicalNotificationInput,
  ): Promise<PaymentAck> {
    const payment = await this.historicalEpayPaymentFor(input.body, config.id);
    if (!payment) {
      this.logger.warn('易支付回调未精确匹配到历史支付尝试，拒绝落库');
      return adapter.ack({
        ok: false,
        ackSuccess: false,
        reason: '易支付回调未匹配到支付尝试',
        rawPayload: '',
      });
    }

    const methods: VisiblePaymentMethod[] =
      payment.providerMethod && isVisiblePaymentMethod(payment.providerMethod)
        ? [payment.providerMethod]
        : ['alipay', 'wechat'];
    let lastFailure: NotificationResult | undefined;
    for (const expectedPaymentMethod of methods) {
      let result: NotificationResult;
      try {
        result = await adapter.verifyNotification({
          config: this.contextOf(config),
          headers: input.headers,
          rawBody: input.rawBody,
          body: input.body,
          expectedPaymentMethod,
        });
      } catch (e) {
        this.logger.error(
          `易支付回调处理异常 (${config.id}/${expectedPaymentMethod}): ${(e as Error).message}`,
        );
        continue;
      }
      if (!result.ok) {
        lastFailure = result;
        continue;
      }
      return this.persistVerified(
        adapter,
        { config, result, payment, expectedPaymentMethod },
        input,
      );
    }

    this.logger.warn(`易支付回调未通过验签 (${config.id})`);
    return adapter.ack(
      lastFailure ?? {
        ok: false,
        ackSuccess: false,
        reason: '易支付回调验签失败',
        rawPayload: '',
      },
    );
  }

  /**
   * 规范回调入口：URL 不携带 configId，必须从订单引用的历史 Payment 反查
   * 当时的配置版本并逐个验签。绝不能回落到“该渠道最新配置”，否则轮换密钥后
   * 历史订单会验签失败，甚至可能把同一订单串到另一个实例。
   *
   * `legacyConfig` 由旧版 `ingest()` 传入：配置已按 configId 精确定位，跳过
   * 白名单与反查，直接沿用旧渠道的验签方式，最终仍汇入 `persistVerified()`。
   */
  async ingestCanonical(
    input: CanonicalNotificationInput,
    legacyConfig?: ResolvedPaymentConfig,
  ): Promise<PaymentAck> {
    const adapter = getAdapter(input.providerId);
    if (!adapter) {
      return {
        status: 404,
        body: JSON.stringify({ code: 'FAIL', message: '未知支付渠道' }),
        contentType: 'application/json; charset=utf-8',
      };
    }

    if (legacyConfig) {
      return input.providerId === 'epay'
        ? this.acceptEpayWithConfig(adapter, legacyConfig, input)
        : this.acceptWithConfig(adapter, legacyConfig, input);
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

    return this.persistVerified(adapter, resolved, input);
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

    return this.persistVerified(
      adapter,
      {
        config,
        result,
        ...(expectedPaymentMethod ? { expectedPaymentMethod } : {}),
      },
      input,
    );
  }

  /** 验签通过后的唯一落库与同步处理路径。 */
  private async persistVerified(
    adapter: PaymentAdapter,
    resolved: ResolvedCanonicalCallback,
    input: CanonicalNotificationInput,
  ): Promise<PaymentAck> {
    const { config, result, payment, expectedPaymentMethod } = resolved;
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
              reason: result.reason ?? null,
              paidAt: result.paidAt ? result.paidAt.toISOString() : null,
              paymentId: payment?.id ?? null,
              providerConfigVersion: config.version,
              providerInstanceId: config.instanceId,
              expectedPaymentMethod: expectedPaymentMethod ?? null,
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

    // 历史 Payment 没有 providerConfigId 时，验签后已经解析出实际配置；
    // 收件箱必须同步成该配置，worker 重试时才能继续精确匹配。
    if (row && row.providerConfigId !== config.id) {
      await this.prisma.paymentNotification.update({
        where: { id: row.id },
        data: { providerConfigId: config.id },
      });
      row = { ...row, providerConfigId: config.id };
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
      select: { id: true, providerInstanceId: true },
    });
    if (!order) throw new AppError(40001, '订单不存在，拒绝处理', 400);

    // 历史 Payment 可能没有 providerConfigId：保留这些候选，按它自己的实例
    // 解析到同渠道最新配置，绝不能因此跨渠道或跨实例试配置。
    const loaded = (await this.prisma.payment.findMany({
      where: {
        orderId: order.id,
        channel: input.providerId,
      },
      select: {
        id: true,
        providerConfigId: true,
        providerInstanceId: true,
        providerMethod: true,
        providerRef: true,
        payTransactionId: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })) as HistoricalPaymentRef[];

    let payments = loaded;
    if (input.providerId === 'epay' || input.providerId === 'stripe') {
      payments = payments.filter((payment) => payment.providerRef === providerRef);
    }
    if (payments.length === 0) {
      throw new AppError(40001, '未找到对应的历史支付尝试，拒绝处理', 400);
    }

    const resolvedPayments = await this.resolveHistoricalPayments(
      payments,
      input.providerId,
      order.providerInstanceId,
    );
    if (resolvedPayments.length === 0) {
      throw new AppError(40001, '历史支付尝试无法解析到同渠道配置，拒绝处理', 400);
    }

    const configs = uniqueResolvedConfigs(resolvedPayments);
    const successes: VerifiedCandidate[] = [];
    for (const config of configs) {
      const configPayments = resolvedPayments
        .filter((item) => item.config.id === config.id)
        .map((item) => item.payment);
      if (configPayments.length === 0) continue;

      const knownMethods = Array.from(
        new Set(
          configPayments
            .map((payment) => payment.providerMethod)
            .filter((value): value is VisiblePaymentMethod =>
              isVisiblePaymentMethod(value),
            ),
        ),
      );
      /*
       * EasyPay 的历史 providerMethod 可能为空。此时用同一配置分别尝试
       * alipay/wechat；channel type 参与 MD5，错误 type 会自然验签失败，
       * 绝不信任回调 body 的 type 自证。
       */
      const expectedMethods: Array<VisiblePaymentMethod | undefined> =
        input.providerId !== 'epay'
          ? [undefined]
          : knownMethods.length > 0
            ? knownMethods
            : ['alipay', 'wechat'];

      for (const expectedPaymentMethod of expectedMethods) {
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

    /*
     * 历史 Payment 可能没有 providerConfigId。先保留全部微信支付尝试，
     * 各自按 providerInstanceId → Order.providerInstanceId → default 解析配置，
     * 再尝试用对应 APIv3 密钥解密。未配置 ID 的 Payment 不能再被过滤掉。
     */
    const references = (await this.prisma.payment.findMany({
      where: { channel: 'wechat' },
      select: {
        id: true,
        providerConfigId: true,
        providerInstanceId: true,
        providerMethod: true,
        providerRef: true,
        payTransactionId: true,
        status: true,
        createdAt: true,
        order: { select: { providerInstanceId: true } },
      },
    })) as Array<HistoricalPaymentRef & { order?: { providerInstanceId: string | null } }>;
    const referenceResolutions: ResolvedHistoricalPayment[] = [];
    for (const payment of references) {
      referenceResolutions.push(
        ...(await this.resolveHistoricalPayments(
          [payment],
          'wechat',
          payment.order?.providerInstanceId ?? null,
        )),
      );
    }
    const configs = uniqueResolvedConfigs(referenceResolutions);
    if (configs.length === 0) {
      throw new AppError(40001, '微信回调查不到历史支付配置，拒绝处理', 400);
    }

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
      select: { id: true, providerInstanceId: true },
    });
    if (!order) throw new AppError(40001, '订单不存在，拒绝处理', 400);

    const decryptedConfigIds = new Set(decrypted.map((item) => item.config.id));
    const loaded = (await this.prisma.payment.findMany({
      where: {
        orderId: order.id,
        channel: 'wechat',
      },
      select: {
        id: true,
        providerConfigId: true,
        providerInstanceId: true,
        providerMethod: true,
        providerRef: true,
        payTransactionId: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })) as HistoricalPaymentRef[];
    const resolvedPayments = (
      await this.resolveHistoricalPayments(
        loaded,
        'wechat',
        order.providerInstanceId,
      )
    ).filter((item) => decryptedConfigIds.has(item.config.id));

    const successes: VerifiedCandidate[] = [];
    for (const item of decrypted) {
      const configPayments = resolvedPayments
        .filter((resolved) => resolved.config.id === item.config.id)
        .map((resolved) => resolved.payment);
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

  private async resolveHistoricalPayments(
    payments: HistoricalPaymentRef[],
    providerId: PaymentProviderId,
    orderProviderInstanceId: string | null,
  ): Promise<ResolvedHistoricalPayment[]> {
    const out: ResolvedHistoricalPayment[] = [];
    for (const payment of payments) {
      try {
        const config = payment.providerConfigId
          ? await this.configs.byId(payment.providerConfigId)
          : await this.configs.resolveForOrder({
              channel: providerId,
              providerConfigId: null,
              providerInstanceId:
                payment.providerInstanceId ?? orderProviderInstanceId ?? 'default',
            });
        if (!config || config.providerId !== providerId) continue;
        out.push({ payment, config });
      } catch (e) {
        this.logger.warn(
          `历史支付配置无法读取 (${providerId}/${payment.id}): ${(e as Error).message}`,
        );
      }
    }
    return out;
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
    if (successes.length === 1) {
      return this.withMatchedPayment(successes[0]);
    }

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
    if (byTradeNo.length === 1) {
      return this.withMatchedPayment(byTradeNo[0]);
    }
    throw new AppError(
      40001,
      `${providerId} 回调匹配到多个历史支付配置，拒绝处理`,
      400,
    );
  }

  /**
   * 验签后把回调锁定到唯一 Payment。providerRef / 交易号能精确命中的优先；
   * 微信与支付宝回调没有 providerRef 时，只允许在同一个已验签配置内
   * 唯一命中。仍有多条候选时不在这里按时间猜，交给后续对账转人工。
   */
  private withMatchedPayment(candidate: VerifiedCandidate): ResolvedCanonicalCallback {
    const resultRef = candidate.result.providerRef?.trim();
    let candidates = candidate.payments;
    if (resultRef) {
      candidates = candidates.filter((payment) => payment.providerRef === resultRef);
    }
    const tradeNo = candidate.result.providerTradeNo;
    const exactTrade = tradeNo
      ? candidates.filter((payment) => payment.payTransactionId === tradeNo)
      : [];
    if (exactTrade.length === 1) candidates = exactTrade;
    if (exactTrade.length > 1) return candidate;
    if (candidate.expectedPaymentMethod) {
      const methodMatches = candidates.filter(
        (payment) =>
          payment.providerMethod === null ||
          payment.providerMethod === candidate.expectedPaymentMethod,
      );
      if (methodMatches.length > 0) candidates = methodMatches;
    }
    const pending = candidates.filter((payment) => payment.status === 'pending');
    const pool = pending.length > 0 ? pending : candidates;
    if (pool.length !== 1) return candidate;
    return { ...candidate, payment: pool[0] };
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
        state?: 'paid' | 'closed' | 'pending' | 'failed';
        providerTradeNo?: string;
        providerRef?: string | null;
        amountCents?: number;
        currency?: string;
        providerStatus?: string;
        reason?: string | null;
        paidAt?: string | null;
      };
      if (!normalized.state) throw new Error('收件箱缺少归一化支付状态');
      result = {
        ok: true,
        eventId: row.providerEventId,
        merchantOrderNo: row.merchantOrderNo,
        providerTradeNo: normalized.providerTradeNo ?? '',
        providerRef: normalized.providerRef ?? undefined,
        amountCents: normalized.amountCents ?? -1,
        currency: (normalized.currency as 'CNY' | 'USD') ?? 'CNY',
        state: normalized.state,
        ...(normalized.paidAt ? { paidAt: new Date(normalized.paidAt) } : {}),
        providerStatus: normalized.providerStatus ?? 'SUCCESS',
        ackSuccess: true,
        ...(normalized.reason ? { reason: normalized.reason } : {}),
        rawPayload: this.cipher.decrypt(row.payloadCipher),
      };
    } catch (e) {
      await this.markFailed(notificationId, `收件箱数据损坏: ${(e as Error).message}`);
      return 'dead';
    }

    let outcome: { ok: boolean; permanent?: boolean; reason?: string };
    try {
      outcome = await this.processNotification(notificationId, result);
    } catch (e) {
      // 行已被 claim 成 processing，不能让未预期异常把它锁死到租约回收。
      const message = ((e as Error)?.message ?? String(e)).slice(0, 200);
      this.logger.error(`通知重试异常 ${notificationId}: ${message}`);
      await this.prisma.paymentNotification
        .updateMany({
          where: { id: notificationId, status: 'processing' },
          data: { status: 'failed', nextAttemptAt: new Date(), lastError: message },
        })
        .catch(() => undefined);
      return 'retry';
    }
    if (outcome.ok) return 'processed';
    if (outcome.permanent) {
      await this.markFailed(notificationId, outcome.reason ?? '永久失败');
      return 'dead';
    }
    return 'retry';
  }

  // ── 内部 ────────────────────────────────────────────────────────

  /** 易支付旧入口的先验定位：订单号 + 固定配置 + 渠道单据号 → 历史 Payment。 */
  private async historicalEpayPaymentFor(
    body: Record<string, unknown>,
    configId: string,
  ): Promise<HistoricalPaymentRef | null> {
    const merchantOrderNo =
      typeof body.param === 'string' ? body.param.trim() : '';
    if (!merchantOrderNo) return null;

    const order = await this.prisma.order.findUnique({
      where: { orderNo: merchantOrderNo },
      select: { id: true },
    });
    if (!order) return null;

    const providerRef =
      typeof body.orderId === 'string' ? body.orderId.trim() : '';
    if (!providerRef) return null;
    return this.prisma.payment.findFirst({
      where: {
        orderId: order.id,
        channel: 'epay',
        providerConfigId: configId,
        providerRef,
      },
      select: {
        id: true,
        providerConfigId: true,
        providerInstanceId: true,
        providerMethod: true,
        providerRef: true,
        payTransactionId: true,
        status: true,
        createdAt: true,
      },
    });
  }

  private notificationMetadata(normalizedJson: string): NotificationMetadata {
    const raw = safeJson(normalizedJson);
    const paymentId =
      typeof raw.paymentId === 'string' && raw.paymentId.trim()
        ? raw.paymentId.trim()
        : undefined;
    const providerConfigVersion =
      typeof raw.providerConfigVersion === 'number' &&
      Number.isInteger(raw.providerConfigVersion)
        ? raw.providerConfigVersion
        : undefined;
    const providerInstanceId =
      typeof raw.providerInstanceId === 'string' && raw.providerInstanceId.trim()
        ? raw.providerInstanceId.trim()
        : undefined;
    const expectedPaymentMethod = isVisiblePaymentMethod(
      raw.expectedPaymentMethod,
    )
      ? raw.expectedPaymentMethod
      : undefined;
    return {
      ...(paymentId ? { paymentId } : {}),
      ...(providerConfigVersion !== undefined ? { providerConfigVersion } : {}),
      ...(providerInstanceId ? { providerInstanceId } : {}),
      ...(expectedPaymentMethod ? { expectedPaymentMethod } : {}),
    };
  }

  /**
   * 收件箱只保存验签后的元数据，worker 重试时也不能重新猜测 Payment。
   * 优先使用验签时锁定的 paymentId；旧记录则按订单、渠道、配置版本、
   * providerRef 与实例/支付方式精确筛选。多个候选无法消歧时永久拒绝。
   */
  private async resolvePaymentAttempt(
    orderId: string,
    providerId: string,
    providerConfigId: string,
    result: Extract<NotificationResult, { ok: true }>,
    metadata: NotificationMetadata,
  ): Promise<PaymentAttemptResolution> {
    const select = {
      id: true,
      orderId: true,
      channel: true,
      providerConfigId: true,
      providerConfigVersion: true,
      providerInstanceId: true,
      providerMethod: true,
      providerRef: true,
      payTransactionId: true,
      status: true,
      createdAt: true,
    } as const;
    const providerRef = result.providerRef?.trim() || undefined;

    if (metadata.paymentId) {
      const payment = await this.prisma.payment.findUnique({
        where: { id: metadata.paymentId },
        select,
      });
      if (!payment) {
        return { error: `回执锁定的支付尝试 ${metadata.paymentId} 不存在` };
      }
      return this.validatePaymentAttempt(
        payment,
        orderId,
        providerId,
        providerConfigId,
        providerRef,
        result.providerTradeNo,
        metadata,
      );
    }

    const candidates = await this.prisma.payment.findMany({
      where: {
        orderId,
        channel: providerId,
        OR: [
          { providerConfigId },
          { providerConfigId: null },
        ],
        ...(providerRef ? { providerRef } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select,
    });
    if (candidates.length === 0) {
      return {
        error: providerRef
          ? `回调渠道单据号 ${providerRef} 未匹配到支付尝试，禁止回落到最新支付记录`
          : '回调未匹配到同订单、渠道和配置版本的支付尝试',
      };
    }

    const validated = candidates
      .map((payment) =>
        this.validatePaymentAttempt(
          payment,
          orderId,
          providerId,
          providerConfigId,
          providerRef,
          result.providerTradeNo,
          metadata,
        ),
      )
      .filter((item): item is { payment: PaymentAttemptRef } => Boolean(item.payment));
    if (validated.length === 0) {
      return { error: '支付尝试的配置版本、实例或支付方式与验签结果不一致' };
    }

    const exactTrade = result.providerTradeNo
      ? validated.filter(
          (item) => item.payment.payTransactionId === result.providerTradeNo,
        )
      : [];
    if (exactTrade.length === 1) return exactTrade[0];
    if (exactTrade.length > 1) {
      return { error: '渠道交易号匹配到多个支付尝试，拒绝处理' };
    }

    const pending = validated.filter((item) => item.payment.status === 'pending');
    if (pending.length === 1) return pending[0];
    if (pending.length > 1) {
      return { error: '回调匹配到多个待支付尝试，无法安全确定归属' };
    }
    if (validated.length === 1) return validated[0];
    return { error: '回调匹配到多个历史支付尝试，无法安全确定归属' };
  }

  private validatePaymentAttempt(
    payment: PaymentAttemptRef,
    orderId: string,
    providerId: string,
    providerConfigId: string,
    providerRef: string | undefined,
    providerTradeNo: string,
    metadata: NotificationMetadata,
  ): PaymentAttemptResolution {
    if (payment.orderId !== orderId || payment.channel !== providerId) {
      return { error: '支付尝试与回调订单或渠道不一致' };
    }
    if (
      payment.providerConfigId !== null &&
      payment.providerConfigId !== providerConfigId
    ) {
      return { error: '支付尝试与回调配置版本不一致' };
    }
    if (
      metadata.providerConfigVersion !== undefined &&
      payment.providerConfigVersion !== null &&
      payment.providerConfigVersion !== metadata.providerConfigVersion
    ) {
      return { error: '支付尝试与回调配置版本不一致' };
    }
    if (
      metadata.providerInstanceId &&
      payment.providerInstanceId &&
      payment.providerInstanceId !== metadata.providerInstanceId
    ) {
      return { error: '支付尝试与回调服务商实例不一致' };
    }
    if (
      metadata.expectedPaymentMethod &&
      payment.providerMethod &&
      payment.providerMethod !== metadata.expectedPaymentMethod
    ) {
      return { error: '支付尝试与回调支付方式不一致' };
    }
    if (providerRef && payment.providerRef !== providerRef) {
      return { error: '支付尝试与回调渠道单据号不一致' };
    }
    if (
      payment.payTransactionId &&
      providerTradeNo &&
      payment.payTransactionId !== providerTradeNo
    ) {
      return { error: '支付尝试与回调渠道交易号不一致' };
    }
    return { payment };
  }

  private async processNotification(
    notificationId: string,
    result: Extract<NotificationResult, { ok: true }>,
  ): Promise<{ ok: boolean; permanent?: boolean; reason?: string }> {
    const row = await this.prisma.paymentNotification.findUnique({ where: { id: notificationId } });
    if (!row) return { ok: false, permanent: true, reason: '收件箱记录不存在' };
    const metadata = this.notificationMetadata(row.normalizedJson);
    const exceptionInstanceId = metadata.providerInstanceId ?? 'default';

    if (result.state !== 'paid') {
      try {
        return await this.applyNonPaidResult(
          notificationId,
          row,
          result,
          metadata,
        );
      } catch (e) {
        const message = (e as Error)?.message ?? String(e);
        await this.scheduleRetry(notificationId, message);
        return { ok: false, reason: message };
      }
    }

    const order = await this.prisma.order.findUnique({ where: { orderNo: row.merchantOrderNo } });
    if (!order) {
      await this.recordException({
        providerId: row.providerId,
        providerInstanceId: exceptionInstanceId,
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
    const attemptResolution = await this.resolvePaymentAttempt(
      order.id,
      row.providerId,
      row.providerConfigId,
      result,
      metadata,
    );
    const attempt = attemptResolution.payment;
    if (!attempt) {
      const detail =
        attemptResolution.error ??
        '回调未精确匹配到支付尝试，禁止回落到同渠道最新支付记录';
      await this.recordException({
        providerId: row.providerId,
        providerInstanceId: exceptionInstanceId,
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
    try {
      const providerInstanceId =
        attempt.providerInstanceId ??
        metadata.providerInstanceId ??
        (await this.configs.byId(row.providerConfigId)).instanceId;
      const providerConfigVersion =
        metadata.providerConfigVersion ??
        attempt.providerConfigVersion ??
        (await this.configs.byId(row.providerConfigId)).version;
      const providerMethod =
        metadata.expectedPaymentMethod ??
        (attempt?.providerMethod && isVisiblePaymentMethod(attempt.providerMethod)
          ? attempt.providerMethod
          : undefined);
      const applied = await this.orders.applyPaymentResult({
        orderId: order.id,
        providerId: row.providerId as PaymentProviderId,
        configId: attempt.providerConfigId ?? row.providerConfigId,
        providerConfigVersion,
        paymentMethod: providerMethod,
        paymentId: attempt.id,
        providerInstanceId,
        tradeNo: result.providerTradeNo,
        amountCents: result.amountCents,
        currency: result.currency,
        paidAt: result.paidAt ?? new Date(),
        providerStatus: result.providerStatus,
        rawPayload: result.rawPayload,
        providerRef,
      });
      if (attempt) {
        await this.prisma.payment.update({
          where: { id: attempt.id },
          data: {
            providerConfigId: attempt.providerConfigId ?? row.providerConfigId,
            providerConfigVersion,
            providerInstanceId,
            ...(providerMethod ? { providerMethod } : {}),
          },
        });
      }
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
          providerInstanceId:
            attempt.providerInstanceId ??
            metadata.providerInstanceId ??
            'default',
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

  /**
   * 非成功结果只更新对应支付尝试，不动订单终态，也不触发入账。
   * 支付尝试仍保持 pending 时允许用户重新发起；已成功的 Payment 绝不被
   * 迟到的 failed/closed 事件覆盖。
   */
  private async applyNonPaidResult(
    notificationId: string,
    row: {
      providerId: string;
      providerConfigId: string;
      merchantOrderNo: string;
    },
    result: VerifiedNotification,
    metadata: NotificationMetadata,
  ): Promise<{ ok: boolean; permanent?: boolean; reason?: string }> {
    const order = await this.prisma.order.findUnique({
      where: { orderNo: row.merchantOrderNo },
      select: { id: true, status: true },
    });
    if (!order) {
      await this.markProcessed(notificationId, { state: result.state });
      return { ok: true };
    }

    const attemptResolution = await this.resolvePaymentAttempt(
      order.id,
      row.providerId,
      row.providerConfigId,
      result,
      metadata,
    );
    const attempt = attemptResolution.payment;
    if (!attempt) {
      // 非资金事件无法定位尝试时不制造异常单，但保留日志和回执状态。
      this.logger.warn(
        `非成功回调未匹配到支付尝试 (${row.providerId}/${row.merchantOrderNo}/${result.state}): ${attemptResolution.error ?? 'unknown'}`,
      );
      await this.markProcessed(notificationId, {
        state: result.state,
        paymentMatched: false,
      });
      return { ok: true };
    }

    if (result.state !== 'pending' && attempt.status === 'pending') {
      const reason =
        result.reason ??
        (result.state === 'failed' ? '渠道确认支付失败' : '渠道确认支付已关闭');
      await this.prisma.payment.updateMany({
        where: { id: attempt.id, status: 'pending' },
        data: {
          status: result.state === 'failed' ? 'failed' : 'closed',
          providerStatus: result.providerStatus,
          rawPayload: result.rawPayload,
          lastError: reason,
          message: reason,
          ...(result.state === 'closed' ? { closedAt: new Date() } : {}),
        },
      });
      await this.prisma.order.updateMany({
        where: { id: order.id, status: 'pending' },
        data: { lastError: reason, lastQueriedAt: new Date() },
      });
    }

    await this.markProcessed(notificationId, {
      state: result.state,
      paymentId: attempt.id,
      paymentStatus: result.state === 'pending' ? attempt.status : result.state,
    });
    return { ok: true };
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
    providerInstanceId?: string;
    orderId?: string;
    merchantOrderNo: string;
    providerTradeNo: string;
    amountCents: number;
    currency: string;
    result: string;
    detail: string;
  }): Promise<void> {
    try {
      const providerInstanceId = input.providerInstanceId || 'default';
      const billDate = shanghaiDate(new Date());
      let run = await this.prisma.paymentReconciliationRun.findFirst({
        where: {
          providerId: input.providerId,
          providerInstanceId,
          billDate,
          source: 'notification',
          status: 'completed',
        },
        orderBy: { attempt: 'desc' },
      });
      if (!run) {
        const max = await this.prisma.paymentReconciliationRun.aggregate({
          where: { providerId: input.providerId, providerInstanceId, billDate },
          _max: { attempt: true },
        });
        run = await this.prisma.paymentReconciliationRun.create({
          data: {
            providerId: input.providerId,
            providerInstanceId,
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
      // 差异落库是保障资金可追踪的关键路径。吞掉异常会让渠道停止重试，
      // 却留下没有异常单/退款任务的真实扣款，因此必须向上游抛出让其重试。
      this.logger.error(`回调差异写入失败 (${input.providerId}/${input.merchantOrderNo}): ${(e as Error).message}`);
      throw e;
    }
  }
}

function uniqueResolvedConfigs(
  payments: ResolvedHistoricalPayment[],
): ResolvedPaymentConfig[] {
  const byId = new Map<string, ResolvedPaymentConfig>();
  for (const item of payments) {
    if (!byId.has(item.config.id)) byId.set(item.config.id, item.config);
  }
  return Array.from(byId.values());
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
