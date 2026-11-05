import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PaymentExceptionCase, Prisma, Refund } from '@prisma/client';
import { AppError } from '../common/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGateway } from './payment-gateway';

export const PAYMENT_EXCEPTION_STATUSES = [
  'open',
  'auto_refund_pending',
  'refunded',
  'manual_review',
  'closed',
] as const;

export type PaymentExceptionStatus = (typeof PAYMENT_EXCEPTION_STATUSES)[number];
export type AutoRefundOutcome =
  | 'refunded'
  | 'refund_processing'
  | 'manual_review';

export interface PaymentExceptionView {
  id: string;
  providerId: string;
  orderId: string | null;
  merchantOrderNo: string;
  providerTradeNo: string | null;
  amountCents: number;
  currency: string;
  kind: string;
  status: string;
  priority: string;
  ownerId: string | null;
  slaDueAt: string;
  overdue: boolean;
  refundId: string | null;
  refundStatus: string | null;
  providerRefundId: string | null;
  resolution: string | null;
  lastError: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const TERMINAL_STATUSES = new Set<string>(['refunded', 'closed']);
const SLA_MS = 2 * 3600_000;

export interface PaymentExceptionInput {
  providerId: string;
  orderId?: string | null;
  refundId?: string | null;
  merchantOrderNo: string;
  providerTradeNo?: string | null;
  amountCents: number;
  currency?: string;
  kind: string;
  detail: string;
  priority?: 'urgent' | 'normal';
}

/**
 * 支付异常补偿。
 *
 * 对账明细只是某次运行的快照；真正需要财务跟进的差异必须落到独立异常单，
 * 否则下一次运行复用/覆盖后，一笔真实扣款可能从工作台消失。
 */
@Injectable()
export class PaymentExceptionService {
  private readonly logger = new Logger(PaymentExceptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
  ) {}

  async recordManual(input: PaymentExceptionInput): Promise<PaymentExceptionCase> {
    return this.upsertCase(input, 'manual_review');
  }

  async recordOpen(input: PaymentExceptionInput): Promise<PaymentExceptionCase> {
    return this.upsertCase(input, 'open');
  }

  /**
   * 已取消订单在渠道成功扣款时，只对**能精确匹配到本订单成功支付流水**的记录自动退款。
   * 匹配不到、金额/币种不一致或渠道退款失败时一律转人工，绝不猜测交易关系。
   */
  async autoRefundCancelledPayment(input: {
    providerId: string;
    merchantOrderNo: string;
    providerTradeNo: string;
    amountCents: number;
    currency?: string;
    detail: string;
    actorId?: string;
  }): Promise<{ case: PaymentExceptionView; outcome: AutoRefundOutcome }> {
    const exception = await this.upsertCase(
      {
        providerId: input.providerId,
        merchantOrderNo: input.merchantOrderNo,
        providerTradeNo: input.providerTradeNo,
        amountCents: input.amountCents,
        currency: input.currency,
        kind: 'cancelled_but_paid',
        detail: input.detail,
      },
      'open',
    );
    if (exception.status === 'refunded' || exception.status === 'closed') {
      return { case: await this.withRefund(exception), outcome: 'refunded' };
    }
    return this.executeAutoRefund(exception, input.actorId ?? 'system:payment-reconciliation');
  }

  async retryAutoRefund(caseId: string, actorId: string) {
    const row = await this.requireCase(caseId);
    if (row.status === 'refunded' || row.status === 'closed') {
      throw new AppError(40901, '该异常单已经结案，不能重复退款', 409);
    }
    if (row.status === 'auto_refund_pending') {
      throw new AppError(40901, '渠道退款仍在处理中，请先核对退款单状态', 409);
    }
    if (row.kind !== 'cancelled_but_paid') {
      throw new AppError(40001, '该异常单不是可自动退款的已取消订单扣款', 400);
    }
    return this.executeAutoRefund(row, actorId);
  }

  async claim(caseId: string, ownerId: string) {
    const changed = await this.prisma.paymentExceptionCase.updateMany({
      where: {
        id: caseId,
        ownerId: null,
        status: { in: ['open', 'manual_review'] },
      },
      data: { ownerId },
    });
    if (changed.count === 0) {
      const row = await this.requireCase(caseId);
      if (row.ownerId === ownerId) return this.withRefund(row);
      if (row.ownerId) throw new AppError(40901, '该异常单已被其他人员认领', 409);
      throw new AppError(40901, '该异常单当前状态不可认领', 409);
    }
    return this.withRefund(await this.requireCase(caseId));
  }

  async close(caseId: string, actorId: string, resolution: string) {
    const text = String(resolution ?? '').trim();
    if (text.length < 2) throw new AppError(40001, '请填写人工结案依据', 400);
    const changed = await this.prisma.paymentExceptionCase.updateMany({
      where: {
        id: caseId,
        status: { in: ['open', 'manual_review'] },
      },
      data: {
        status: 'closed',
        ownerId: actorId,
        resolution: text.slice(0, 500),
        closedAt: new Date(),
      },
    });
    if (changed.count === 0) {
      throw new AppError(40901, '该异常单正在退款或已经结案，不能手动关闭', 409);
    }
    return this.withRefund(await this.requireCase(caseId));
  }

  async list(query: {
    status?: string;
    providerId?: string;
    priority?: string;
    overdue?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 30));
    const where: Prisma.PaymentExceptionCaseWhereInput = {};
    if (query.status && query.status !== 'all') where.status = query.status;
    if (query.providerId) where.providerId = query.providerId;
    if (query.priority) where.priority = query.priority;
    if (query.overdue) {
      where.slaDueAt = { lt: new Date() };
      where.status = { notIn: ['refunded', 'closed'] };
    }

    const [rows, total] = await Promise.all([
      this.prisma.paymentExceptionCase.findMany({
        where,
        orderBy: [{ status: 'asc' }, { slaDueAt: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.paymentExceptionCase.count({ where }),
    ]);
    const refunds = await this.refundsById(rows.map((row) => row.refundId));
    return {
      items: rows.map((row) => this.toView(row, refunds.get(row.refundId ?? '') ?? null)),
      total,
      page,
      pageSize,
    };
  }

  async get(caseId: string) {
    return this.withRefund(await this.requireCase(caseId));
  }

  /** 运营在渠道后台核销异步退款后，同步关闭/更新关联异常单。 */
  async markRefundResolved(refundId: string, outcome: 'succeeded' | 'failed') {
    const row = await this.prisma.paymentExceptionCase.findFirst({ where: { refundId } });
    if (!row) return null;
    const updated = await this.prisma.paymentExceptionCase.update({
      where: { id: row.id },
      data:
        outcome === 'succeeded'
          ? {
              status: 'refunded',
              closedAt: new Date(),
              lastError: null,
              resolution: '运营核对渠道后确认退款成功',
            }
          : {
              status: 'manual_review',
              lastError: '运营核对渠道后确认退款失败，需继续处理',
            },
    });
    return this.withRefund(updated);
  }

  /** 自动对账连续失败后落单，避免只在日志里留痕。 */
  async recordReconciliationFailure(input: {
    providerId: string;
    billDate: string;
    error: string;
  }) {
    return this.recordManual({
      providerId: input.providerId,
      merchantOrderNo: `auto-reconcile:${input.billDate}`,
      amountCents: 0,
      currency: 'CNY',
      kind: 'auto_reconcile_failed',
      detail: input.error,
    });
  }

  private async executeAutoRefund(
    exception: PaymentExceptionCase,
    actorId: string,
  ): Promise<{ case: PaymentExceptionView; outcome: AutoRefundOutcome }> {
    const order = await this.prisma.order.findUnique({
      where: { orderNo: exception.merchantOrderNo },
      include: { payments: true },
    });
    if (!order || order.status !== 'cancelled') {
      return this.manualReview(exception, '订单不存在或已不是取消状态，需人工核对');
    }
    if (!exception.providerTradeNo) {
      return this.manualReview(exception, '异常单缺少渠道交易号，无法安全自动退款');
    }
    const payment = order.payments.find(
      (row) =>
        row.status === 'succeeded' &&
        row.channel === exception.providerId &&
        row.payTransactionId === exception.providerTradeNo,
    );
    if (!payment) {
      return this.manualReview(
        exception,
        '未匹配到本订单的成功支付流水，禁止仅凭账单自动退款',
      );
    }
    if (payment.amountCents !== exception.amountCents) {
      return this.manualReview(
        exception,
        `账单金额 ${exception.amountCents} 分与成功支付流水 ${payment.amountCents} 分不一致`,
      );
    }
    if ((exception.currency || 'CNY') !== (order.currency || 'CNY')) {
      return this.manualReview(exception, '账单币种与订单币种不一致');
    }
    if (payment.channel === 'manual') {
      return this.manualReview(exception, '手工标记支付不存在真实渠道资金，需人工处理');
    }

    // 匹配完成后再抢占异常单。两个回调/对账任务同时到达时只能有一个发起退款，
    // 后到者读取最新状态并等待人工核销，绝不重复调用渠道退款。
    const claimed = await this.prisma.paymentExceptionCase.updateMany({
      where: {
        id: exception.id,
        status: { in: ['open', 'manual_review'] },
      },
      data: { status: 'auto_refund_pending', ownerId: actorId, lastError: null },
    });
    if (claimed.count === 0) {
      const latest = await this.requireCase(exception.id);
      if (latest.status === 'auto_refund_pending') {
        return {
          case: await this.withRefund(latest),
          outcome: 'refund_processing',
        };
      }
      if (latest.status === 'refunded' || latest.status === 'closed') {
        return { case: await this.withRefund(latest), outcome: 'refunded' };
      }
      throw new AppError(40901, '异常单状态已变化，请刷新后重试', 409);
    }

    let refund = exception.refundId
      ? await this.prisma.refund.findUnique({ where: { id: exception.refundId } })
      : null;
    if (!refund) {
      refund = await this.prisma.refund.findFirst({
        where: {
          orderId: order.id,
          paymentId: payment.id,
          amountCents: exception.amountCents,
          reason: { contains: '自动原路退款' },
          status: { in: ['processing', 'succeeded', 'failed'] },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (refund?.status === 'succeeded') {
      return this.markRefunded(exception.id, refund);
    }
    if (refund?.status === 'processing') {
      const updated = await this.prisma.paymentExceptionCase.update({
        where: { id: exception.id },
        data: { status: 'auto_refund_pending', refundId: refund.id, lastError: null },
      });
      return { case: await this.withRefund(updated), outcome: 'refund_processing' };
    }

    if (refund?.status === 'failed') {
      const claimed = await this.prisma.refund.updateMany({
        where: { id: refund.id, status: 'failed' },
        data: { status: 'processing', detail: '{}' },
      });
      if (claimed.count === 0) {
        return this.manualReview(exception, '退款单状态已变化，请刷新后核对');
      }
    } else {
      refund = await this.prisma.refund.create({
        data: {
          orderId: order.id,
          paymentId: payment.id,
          userId: order.userId,
          amountCents: exception.amountCents,
          creditsReclaimed: 0,
          creditsUnreclaimable: 0,
          reason: '对账发现已取消订单在渠道成功扣款，自动原路退款',
          operatorId: actorId,
          status: 'processing',
          detail: '{}',
        },
      });
    }

    await this.prisma.paymentExceptionCase.update({
      where: { id: exception.id },
      data: { status: 'auto_refund_pending', refundId: refund.id, ownerId: actorId },
    });

    let result;
    try {
      result = await this.gateway.refund({
        order: {
          channel: payment.channel,
          providerConfigId: payment.providerConfigId ?? order.providerConfigId,
        },
        orderNo: order.orderNo,
        outRefundNo: refund.id,
        amountCents: exception.amountCents,
        totalCents: payment.amountCents || order.paidCents,
        reason: refund.reason,
        providerRef: payment.providerRef ?? undefined,
        providerTradeNo: payment.payTransactionId ?? undefined,
      });
    } catch (error) {
      // 渠道调用直接抛错时没有返回状态，绝不能把异常单永久停在
      // auto_refund_pending；退款单落 failed 并转人工，等待运营核销。
      const message = (error as Error)?.message || '渠道退款调用异常';
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: 'failed',
          detail: JSON.stringify({ automatic: true, error: message }),
        },
      });
      this.logger.error(
        `自动退款调用异常: case=${exception.id} refund=${refund.id} provider=${exception.providerId} — ${message}`,
      );
      return this.manualReview(exception, `自动退款调用异常: ${message}`);
    }

    if (result.state === 'succeeded') {
      const updatedRefund = await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: 'succeeded',
          providerRefundId: result.providerRefundId ?? null,
          detail: JSON.stringify({ automatic: true, raw: result.raw ?? null }),
        },
      });
      return this.markRefunded(exception.id, updatedRefund);
    }
    if (result.state === 'processing') {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: 'processing',
          providerRefundId: result.providerRefundId ?? null,
          detail: JSON.stringify({ automatic: true, note: '渠道异步处理中', raw: result.raw ?? null }),
        },
      });
      const updated = await this.prisma.paymentExceptionCase.update({
        where: { id: exception.id },
        data: { status: 'auto_refund_pending', lastError: null },
      });
      return { case: await this.withRefund(updated), outcome: 'refund_processing' };
    }

    await this.prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: 'failed',
        providerRefundId: result.providerRefundId ?? null,
        detail: JSON.stringify({ automatic: true, error: result.error ?? null, raw: result.raw ?? null }),
      },
    });
    this.logger.error(
      `自动退款失败: case=${exception.id} refund=${refund.id} provider=${exception.providerId} — ${result.error ?? '未知原因'}`,
    );
    return this.manualReview(exception, `自动退款失败: ${result.error ?? '未知原因'}`);
  }

  private async upsertCase(
    input: PaymentExceptionInput,
    initialStatus: 'open' | 'manual_review',
  ): Promise<PaymentExceptionCase> {
    const fingerprint = exceptionFingerprint(input);
    const existing = await this.prisma.paymentExceptionCase.findUnique({ where: { fingerprint } });
    if (!existing) {
      return this.prisma.paymentExceptionCase
        .create({
        data: {
          fingerprint,
          providerId: input.providerId,
          orderId: input.orderId ?? null,
          refundId: input.refundId ?? null,
          merchantOrderNo: input.merchantOrderNo,
          providerTradeNo: input.providerTradeNo ?? null,
          amountCents: Math.max(0, Math.trunc(input.amountCents)),
          currency: input.currency || 'CNY',
          kind: input.kind,
          status: initialStatus,
          priority: input.priority ?? 'urgent',
          slaDueAt: new Date(Date.now() + SLA_MS),
          lastError: input.detail.slice(0, 500),
        },
        })
        .catch(async (error: unknown) => {
          // 两个回调/对账任务可能同时发现同一事件；唯一键冲突后回查赢家，
          // 再走一次更新逻辑，保证调用方拿到稳定的异常单。
          if ((error as { code?: string })?.code === 'P2002') {
            return this.upsertCase(input, initialStatus);
          }
          throw error;
        });
    }
    if (TERMINAL_STATUSES.has(existing.status)) return existing;

    // 自动退款处理中不能被后续回调/对账重新打回 open，否则并发任务会再次退款。
    const status = existing.status === 'auto_refund_pending' ? existing.status : initialStatus;
    return this.prisma.paymentExceptionCase.update({
      where: { id: existing.id },
      data: {
        orderId: input.orderId ?? existing.orderId,
        refundId: input.refundId ?? existing.refundId,
        providerTradeNo: input.providerTradeNo ?? existing.providerTradeNo,
        amountCents: Math.max(0, Math.trunc(input.amountCents)),
        currency: input.currency || existing.currency,
        priority: input.priority ?? existing.priority,
        status,
        lastError: input.detail.slice(0, 500),
      },
    });
  }

  private async manualReview(
    exception: PaymentExceptionCase,
    reason: string,
  ): Promise<{ case: PaymentExceptionView; outcome: 'manual_review' }> {
    const updated = await this.prisma.paymentExceptionCase.update({
      where: { id: exception.id },
      data: { status: 'manual_review', lastError: reason.slice(0, 500) },
    });
    return { case: await this.withRefund(updated), outcome: 'manual_review' as const };
  }

  private async markRefunded(exceptionId: string, refund: Refund) {
    const updated = await this.prisma.paymentExceptionCase.update({
      where: { id: exceptionId },
      data: {
        status: 'refunded',
        refundId: refund.id,
        closedAt: new Date(),
        lastError: null,
        resolution: '已自动原路退款',
      },
    });
    return { case: await this.withRefund(updated), outcome: 'refunded' as const };
  }

  private async requireCase(caseId: string): Promise<PaymentExceptionCase> {
    const row = await this.prisma.paymentExceptionCase.findUnique({ where: { id: caseId } });
    if (!row) throw new AppError(40400, '支付异常单不存在', 404);
    return row;
  }

  private async withRefund(row: PaymentExceptionCase): Promise<PaymentExceptionView> {
    const refund = row.refundId
      ? await this.prisma.refund.findUnique({ where: { id: row.refundId } })
      : null;
    return this.toView(row, refund);
  }

  private async refundsById(ids: Array<string | null>) {
    const present = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    const rows = present.length
      ? await this.prisma.refund.findMany({ where: { id: { in: present } } })
      : [];
    return new Map(rows.map((row) => [row.id, row]));
  }

  private toView(
    row: PaymentExceptionCase,
    refund: Refund | null,
  ): PaymentExceptionView {
    return {
      id: row.id,
      providerId: row.providerId,
      orderId: row.orderId,
      merchantOrderNo: row.merchantOrderNo,
      providerTradeNo: row.providerTradeNo,
      amountCents: row.amountCents,
      currency: row.currency,
      kind: row.kind,
      status: row.status,
      priority: row.priority,
      ownerId: row.ownerId,
      slaDueAt: row.slaDueAt.toISOString(),
      overdue: row.slaDueAt.getTime() < Date.now() && !TERMINAL_STATUSES.has(row.status),
      refundId: row.refundId,
      refundStatus: refund?.status ?? null,
      providerRefundId: refund?.providerRefundId ?? null,
      resolution: row.resolution,
      lastError: row.lastError,
      closedAt: row.closedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function exceptionFingerprint(input: PaymentExceptionInput): string {
  return createHash('sha256')
    .update(
      [
        input.providerId,
        input.merchantOrderNo,
        input.providerTradeNo ?? '',
        input.kind,
        input.refundId ?? '',
      ].join('|'),
    )
    .digest('hex');
}
