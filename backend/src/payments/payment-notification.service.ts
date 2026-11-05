import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { PaymentCipher } from './payment-cipher';
import { PaymentConfigService } from './payment-config.service';
import { PaymentOrderService } from './payment-order.service';
import { getAdapter } from './adapters';
import { NotificationResult, PaymentAck, PaymentProviderId } from './adapters/types';

/** 重试退避：1min、5min、15min、1h，最多 8 次 */
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const MAX_ATTEMPTS = 8;

export interface IngestResult {
  ack: PaymentAck;
}

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
  ) {}

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

    let config;
    try {
      config = await this.configs.byId(input.configId);
    } catch {
      return adapter.ack({ ok: false, ackSuccess: false, reason: '支付配置不存在', rawPayload: '' });
    }
    if (config.providerId !== input.providerId) {
      return adapter.ack({ ok: false, ackSuccess: false, reason: '回调渠道与配置不匹配', rawPayload: '' });
    }

    let result: NotificationResult;
    try {
      result = await adapter.verifyNotification({
        config: {
          providerId: config.providerId,
          configId: config.id,
          configVersion: config.version,
          values: config.values,
        },
        headers: input.headers,
        rawBody: input.rawBody,
        body: input.body,
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
      select: { id: true },
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
      const applied = await this.orders.applyPaymentResult({
        orderId: order.id,
        providerId: row.providerId as PaymentProviderId,
        configId: row.providerConfigId,
        paymentId: attempt?.id,
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
        // 金额/币种/状态不符：这是业务终态, 必须落差异并让渠道停止重试
        await this.recordException({
          providerId: row.providerId,
          orderId: order.id,
          merchantOrderNo: row.merchantOrderNo,
          providerTradeNo: result.providerTradeNo,
          amountCents: result.amountCents,
          currency: result.currency,
          result: message.includes('金额') ? 'amount_mismatch' : 'credit_failed',
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
