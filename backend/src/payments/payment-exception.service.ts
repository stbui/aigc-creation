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
  refundFailureKind: 'definitive' | 'unknown' | null;
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
    if (row.kind !== 'cancelled_but_paid') {
      throw new AppError(40001, '该异常单不是可自动退款的已取消订单扣款', 400);
    }
    /*
     * auto_refund_pending 也允许重试：进程可能在抢占后、调用渠道前退出。
     * 重试始终复用已绑定退款单的 id；渠道按 outRefundNo / 幂等键去重，
     * 不会因为恢复动作产生第二笔退款。
     */
    return this.executeAutoRefund(row, actorId, true);
  }

  /**
   * 运营到渠道商户后台核实异步退款/结果未知退款后的最终核销。
   *
   * 自动退款对象通常是 `cancelled` 订单，不能复用 OrderService 的“成功退款”
   * 记账逻辑（那会回收积分并迁移订单状态）。这里只落退款证据和异常单状态。
   */
  async confirmAutoRefund(
    caseId: string,
    actorId: string,
    input: {
      outcome: 'succeeded' | 'failed';
      providerRefundId?: string;
      reason: string;
    },
  ): Promise<PaymentExceptionView> {
    const reason = String(input.reason ?? '').trim();
    if (!reason) throw new AppError(40001, '请填写人工核销依据', 400);
    if (input.outcome !== 'succeeded' && input.outcome !== 'failed') {
      throw new AppError(40001, '请选择退款核销结果', 400);
    }
    const providerRefundId = String(input.providerRefundId ?? '').trim() || null;

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "PaymentExceptionCase" SET "updatedAt" = "updatedAt" WHERE id = ${caseId}`;
      const row = await tx.paymentExceptionCase.findUnique({ where: { id: caseId } });
      if (!row) throw new AppError(40400, '支付异常单不存在', 404);
      if (row.kind !== 'cancelled_but_paid') {
        throw new AppError(40001, '该异常单不是已取消订单扣款，不能执行自动退款核销', 400);
      }
      if (row.status !== 'auto_refund_pending' && row.status !== 'manual_review') {
        throw new AppError(40901, `异常单当前状态不可核销: ${row.status}`, 409);
      }
      if (!row.refundId) {
        throw new AppError(40901, '异常单尚未绑定退款单，请先重试退款', 409);
      }
      const refund = await tx.refund.findUnique({ where: { id: row.refundId } });
      if (!refund) throw new AppError(40901, '异常单绑定的退款单不存在', 409);
      if (refund.amountCents !== row.amountCents) {
        throw new AppError(40909, '退款单金额与异常单不一致，禁止核销', 409);
      }
      const order = await tx.order.findUnique({
        where: { id: refund.orderId },
        select: { id: true, orderNo: true, status: true, currency: true },
      });
      if (!order || order.orderNo !== row.merchantOrderNo) {
        throw new AppError(40909, '退款单与异常单订单不一致，禁止核销', 409);
      }
      if (order.status !== 'cancelled') {
        throw new AppError(40901, `订单当前状态不可做自动退款核销: ${order.status}`, 409);
      }
      if ((row.currency || 'CNY') !== (order.currency || 'CNY')) {
        throw new AppError(40909, '异常单币种与订单币种不一致，禁止核销', 409);
      }
      if (refund.status !== 'processing' && refund.status !== 'failed') {
        throw new AppError(40909, `退款单当前状态不可人工核销: ${refund.status}`, 409);
      }
      const detail = parseJsonObject(refund.detail);
      if (
        input.outcome === 'succeeded' &&
        refund.status === 'failed' &&
        detail.failureKind === 'definitive'
      ) {
        throw new AppError(
          40901,
          '该退款单已被渠道明确拒绝，不能人工确认成功；如渠道另有退款记录，请先核对并保留凭证',
          409,
        );
      }

      const confirmedAt = new Date().toISOString();
      const evidence = {
        ...detail,
        automatic: true,
        manualConfirmed: true,
        confirmedFromChannelConsole: true,
        confirmationOutcome: input.outcome,
        confirmationReason: reason,
        confirmedBy: actorId,
        confirmedAt,
        offline: false,
        ...(providerRefundId ? { providerRefundId } : {}),
      };
      await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: input.outcome === 'succeeded' ? 'succeeded' : 'failed',
          ...(providerRefundId ? { providerRefundId } : {}),
          detail: JSON.stringify(
            input.outcome === 'failed'
              ? { ...evidence, failureKind: 'definitive' }
              : evidence,
          ),
        },
      });
      await tx.paymentExceptionCase.update({
        where: { id: row.id },
        data:
          input.outcome === 'succeeded'
            ? {
                status: 'refunded',
                ownerId: actorId,
                closedAt: new Date(),
                lastError: null,
                resolution: `人工核对渠道后确认退款成功：${reason}`.slice(0, 500),
              }
            : {
                status: 'manual_review',
                ownerId: actorId,
                lastError: `渠道退款已确认失败：${reason}`.slice(0, 500),
              },
      });
    });

    return this.withRefund(await this.requireCase(caseId));
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
    providerInstanceId?: string;
    billDate: string;
    error: string;
  }) {
    const instanceId = input.providerInstanceId ?? 'default';
    return this.recordManual({
      providerId: input.providerId,
      merchantOrderNo: `auto-reconcile:${input.billDate}:${instanceId}`,
      amountCents: 0,
      currency: 'CNY',
      kind: 'auto_reconcile_failed',
      detail: `服务商实例 ${instanceId}: ${input.error}`,
    });
  }

  private async executeAutoRefund(
    exception: PaymentExceptionCase,
    actorId: string,
    allowPendingRetry = false,
  ): Promise<{ case: PaymentExceptionView; outcome: AutoRefundOutcome }> {
    const prepared = await this.prisma.$transaction(async (tx) => {
      // SQLite 下先用 no-op UPDATE 锁异常单行，再重读校验，防止并发回调重复抢占。
      await tx.$executeRaw`
        UPDATE "PaymentExceptionCase" SET "updatedAt" = "updatedAt" WHERE id = ${exception.id}`;
      const current = await tx.paymentExceptionCase.findUnique({ where: { id: exception.id } });
      if (!current) throw new AppError(40400, '支付异常单不存在', 404);
      if (TERMINAL_STATUSES.has(current.status)) {
        return { kind: 'case' as const, caseId: current.id, outcome: 'refunded' as const };
      }
      if (current.kind !== 'cancelled_but_paid') {
        throw new AppError(40001, '该异常单不是可自动退款的已取消订单扣款', 400);
      }

      const order = await tx.order.findUnique({
        where: { orderNo: current.merchantOrderNo },
        include: { payments: true },
      });
      const manualReview = async (reason: string) => {
        await tx.paymentExceptionCase.update({
          where: { id: current.id },
          data: { status: 'manual_review', lastError: reason.slice(0, 500) },
        });
        return { kind: 'case' as const, caseId: current.id, outcome: 'manual_review' as const };
      };

      if (!order || order.status !== 'cancelled') {
        return manualReview('订单不存在或已不是取消状态，需人工核对');
      }
      if (!current.providerTradeNo) {
        return manualReview('异常单缺少渠道交易号，无法安全自动退款');
      }
      const payment = order.payments.find(
        (row) =>
          row.status === 'succeeded' &&
          row.channel === current.providerId &&
          row.payTransactionId === current.providerTradeNo,
      );
      if (!payment) {
        return manualReview('未匹配到本订单的成功支付流水，禁止仅凭账单自动退款');
      }
      if (payment.amountCents !== current.amountCents) {
        return manualReview(
          `账单金额 ${current.amountCents} 分与成功支付流水 ${payment.amountCents} 分不一致`,
        );
      }
      if ((current.currency || 'CNY') !== (order.currency || 'CNY')) {
        return manualReview('账单币种与订单币种不一致');
      }
      if (payment.channel === 'manual') {
        return manualReview('手工标记支付不存在真实渠道资金，需人工处理');
      }

      let refund = current.refundId
        ? await tx.refund.findUnique({ where: { id: current.refundId } })
        : null;
      if (!refund) {
        refund = await tx.refund.findFirst({
          where: {
            orderId: order.id,
            paymentId: payment.id,
            amountCents: current.amountCents,
            reason: { contains: '自动原路退款' },
            status: { in: ['processing', 'succeeded', 'failed'] },
          },
          orderBy: { createdAt: 'desc' },
        });
      }
      if (
        refund &&
        (refund.orderId !== order.id ||
          refund.paymentId !== payment.id ||
          refund.amountCents !== current.amountCents)
      ) {
        return manualReview('异常单绑定的退款单与订单/支付流水不一致，需人工核对');
      }

      if (refund?.status === 'succeeded') {
        await tx.paymentExceptionCase.update({
          where: { id: current.id },
          data: {
            status: 'refunded',
            refundId: refund.id,
            closedAt: new Date(),
            lastError: null,
            resolution: '已自动原路退款',
          },
        });
        return { kind: 'case' as const, caseId: current.id, outcome: 'refunded' as const };
      }

      if (refund?.status === 'processing') {
        await tx.paymentExceptionCase.update({
          where: { id: current.id },
          data: {
            status: 'auto_refund_pending',
            refundId: refund.id,
            ownerId: actorId,
            lastError: null,
          },
        });
        if (!allowPendingRetry) {
          return { kind: 'case' as const, caseId: current.id, outcome: 'refund_processing' as const };
        }
      } else if (refund?.status === 'failed') {
        const detail = parseJsonObject(refund.detail);
        const needsNewRefund =
          detail.failureKind === 'definitive' || detail.confirmationOutcome === 'failed';
        if (needsNewRefund) {
          refund = await tx.refund.create({
            data: {
              orderId: order.id,
              paymentId: payment.id,
              userId: order.userId,
              amountCents: current.amountCents,
              creditsReclaimed: 0,
              creditsUnreclaimable: 0,
              creditsExpired: 0,
              reason: '对账发现已取消订单在渠道成功扣款，自动原路退款',
              operatorId: actorId,
              status: 'processing',
              detail: '{}',
            },
          });
        } else {
          // unknown（含无 failureKind 的旧数据）必须沿用原退款单号向渠道幂等重试。
          const retried = await tx.refund.updateMany({
            where: { id: refund.id, status: 'failed' },
            data: {
              status: 'processing',
              detail: JSON.stringify({
                ...detail,
                retryStartedAt: new Date().toISOString(),
              }),
            },
          });
          if (retried.count === 0) {
            return manualReview('退款单状态已变化，请刷新后核对');
          }
        }
      } else if (!refund) {
        refund = await tx.refund.create({
          data: {
            orderId: order.id,
            paymentId: payment.id,
            userId: order.userId,
            amountCents: current.amountCents,
            creditsReclaimed: 0,
            creditsUnreclaimable: 0,
            creditsExpired: 0,
            reason: '对账发现已取消订单在渠道成功扣款，自动原路退款',
            operatorId: actorId,
            status: 'processing',
            detail: '{}',
          },
        });
      } else {
        return manualReview(`退款单状态不可自动重试: ${refund.status}`);
      }

      await tx.paymentExceptionCase.update({
        where: { id: current.id },
        data: {
          status: 'auto_refund_pending',
          refundId: refund.id,
          ownerId: actorId,
          lastError: null,
        },
      });
      return { kind: 'send' as const, refund, payment, order };
    });

    if (prepared.kind === 'case') {
      const row = await this.requireCase(prepared.caseId);
      return { case: await this.withRefund(row), outcome: prepared.outcome };
    }

    const { refund, payment, order } = prepared;
    let result;
    try {
      result = await this.gateway.refund({
        order: {
          channel: payment.channel,
          providerConfigId: payment.providerConfigId ?? order.providerConfigId,
          providerInstanceId: payment.providerInstanceId ?? order.providerInstanceId,
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
      const message = (error as Error)?.message || '渠道退款调用异常';
      result = {
        state: 'failed' as const,
        failureKind: 'unknown' as const,
        error: `渠道退款调用异常，结果未知: ${message}`,
      };
    }

    const settled = await this.prisma.$transaction(async (tx) => {
      const confirmedAt = new Date().toISOString();
      const resolveLatestOutcome = async (): Promise<AutoRefundOutcome> => {
        const latest = await tx.refund.findUnique({ where: { id: refund.id } });
        if (latest?.status === 'succeeded') return 'refunded';
        if (latest?.status === 'processing') return 'refund_processing';
        return 'manual_review';
      };
      const updatePendingCase = async (data: Prisma.PaymentExceptionCaseUpdateManyMutationInput) => {
        const changed = await tx.paymentExceptionCase.updateMany({
          where: { id: exception.id, status: 'auto_refund_pending' },
          data,
        });
        return changed.count > 0;
      };

      if (result.state === 'succeeded') {
        const won = await tx.refund.updateMany({
          where: { id: refund.id, status: 'processing' },
          data: {
            status: 'succeeded',
            providerRefundId: result.providerRefundId ?? null,
            detail: JSON.stringify({
              automatic: true,
              providerRefundId: result.providerRefundId ?? null,
              raw: result.raw ?? null,
              confirmedAt,
            }),
          },
        });
        if (won.count === 0) return resolveLatestOutcome();
        const caseUpdated = await updatePendingCase({
          status: 'refunded',
          refundId: refund.id,
          closedAt: new Date(),
          lastError: null,
          resolution: '已自动原路退款',
        });
        if (!caseUpdated) return resolveLatestOutcome();
        return 'refunded' as const;
      }

      if (result.state === 'processing') {
        const won = await tx.refund.updateMany({
          where: { id: refund.id, status: 'processing' },
          data: {
            status: 'processing',
            providerRefundId: result.providerRefundId ?? null,
            detail: JSON.stringify({
              automatic: true,
              note: '渠道异步处理中，需人工核销',
              providerRefundId: result.providerRefundId ?? null,
              raw: result.raw ?? null,
              updatedAt: confirmedAt,
            }),
          },
        });
        if (won.count === 0) return resolveLatestOutcome();
        const caseUpdated = await updatePendingCase({
          status: 'auto_refund_pending',
          refundId: refund.id,
          lastError: null,
        });
        if (!caseUpdated) return resolveLatestOutcome();
        return 'refund_processing' as const;
      }

      const won = await tx.refund.updateMany({
        where: { id: refund.id, status: 'processing' },
        data: {
          status: 'failed',
          providerRefundId: result.providerRefundId ?? null,
          detail: JSON.stringify({
            automatic: true,
            failureKind: result.failureKind,
            error: result.error,
            raw: result.raw ?? null,
            updatedAt: confirmedAt,
          }),
        },
      });
      if (won.count === 0) return resolveLatestOutcome();
      const lastError =
        result.failureKind === 'unknown'
          ? `自动退款结果未知：${result.error}；订单与积分未变更，请用同一退款单号重试或核对渠道`
          : `渠道明确拒绝自动退款：${result.error}；订单与积分未变更，可修正后重试并生成新退款单号`;
      const caseUpdated = await updatePendingCase({
        status: 'manual_review',
        refundId: refund.id,
        lastError: lastError.slice(0, 500),
      });
      if (!caseUpdated) return resolveLatestOutcome();
      return 'manual_review' as const;
    });

    if (settled !== 'manual_review') {
      this.logger.log(
        `自动退款${settled === 'refunded' ? '成功' : '处理中'}: case=${exception.id} refund=${refund.id} provider=${exception.providerId}`,
      );
    } else {
      this.logger.error(
        `自动退款未完成: case=${exception.id} refund=${refund.id} provider=${exception.providerId} — ${result.state === 'failed' ? result.error : '未知状态'}`,
      );
    }
    return {
      case: await this.withRefund(await this.requireCase(exception.id)),
      outcome: settled,
    };
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
      refundFailureKind: refundFailureKind(refund),
      providerRefundId: refund?.providerRefundId ?? null,
      resolution: row.resolution,
      lastError: row.lastError,
      closedAt: row.closedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function refundFailureKind(refund: Refund | null): 'definitive' | 'unknown' | null {
  if (!refund || refund.status !== 'failed') return null;
  const detail = parseJsonObject(refund.detail);
  return detail.failureKind === 'definitive'
    ? 'definitive'
    : detail.failureKind === 'unknown'
      ? 'unknown'
      : null;
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
