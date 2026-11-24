import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, Refund } from '../generated/prisma/client';
import { AppError } from '../common/app.exception';
import { CreditService } from '../credits/credit.service';
import { MembershipService } from '../membership/membership.service';
import { PaymentExceptionService } from '../payments/payment-exception.service';
import { PaymentGateway } from '../payments/payment-gateway';
import { PrismaService } from '../prisma/prisma.service';
import { type OrderStatus, transitionOrder } from './order.state';
import { orderInclude } from './order.view';
import { OrderRefundPolicyService, type RefundRules } from './order-refund-policy.service';

interface RefundSettlementResult {
  refundId: string;
  state: 'succeeded';
  pending: false;
  refundedCents: number;
  fullyRefunded: boolean;
  membershipTerminated: boolean;
  creditsReclaimed: number;
  creditsUnreclaimable: number;
  creditsExpired: number;
  detail: Array<{ lotId: string; taken: number }>;
  invoiceFollowUp: RefundInvoiceFollowUp | null;
}

interface RefundInvoiceFollowUp {
  invoiceId: string;
  invoiceNo: string;
  status: 'pending' | 'issued';
  message: string;
}

interface RefundConfirmationFailure {
  refundId: string;
  orderId: string;
  state: 'failed';
  pending: false;
  refundedCents: number;
}

/** 退款 detail 是自由 JSON 字符串；追加证据时保留渠道原始内容。 */
function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return { previousDetail: raw };
  }
}

/**
 * 退款生命周期：渠道退款、人工核销、成功后的本地记账。
 *
 * 渠道确认成功之前不动订单、积分与会员；同步退款和异步人工核销共用
 * recordRefundSuccess 这一条记账入口。
 */
@Injectable()
export class OrderRefundService {
  private readonly logger = new Logger(OrderRefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credit: CreditService,
    private readonly membership: MembershipService,
    private readonly gateway: PaymentGateway,
    private readonly paymentExceptions: PaymentExceptionService,
    private readonly policy: OrderRefundPolicyService,
  ) {}

  // ── 退款 (B-43) ──────────────────────────────────────────────────

  /**
   * 退款。
   *
   * 按 CreditLot.remaining 逐批扣回 —— 退的是"还没花掉的部分"(B-43)。
   * 已消耗的部分无法追回, 如实记为 creditsUnreclaimable。
   *
   * 支持部分退款: 退款金额小于订单金额时, 订单转partial_refunded。
   */
  async refund(params: {
    orderId: string;
    amountCents: number;
    reason: string;
    operatorId: string;
    /** 退款规则（后台设置）。不传 = 不做额外限制，仅供内部脚本/历史调用 */
    rules?: RefundRules;
  }) {
    const reason = params.reason?.trim();
    if (!reason) throw new AppError(40001, '退款必须填写原因', 400);

    const order = await this.prisma.order.findUnique({
      where: { id: params.orderId },
      include: orderInclude(),
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);
    if (order.status !== 'paid' && order.status !== 'partial_refunded') {
      throw new AppError(40901, '订单状态已变化，无法退款，请刷新后重试', 409);
    }
    if (params.amountCents <= 0) {
      throw new AppError(40001, '退款金额必须大于 0', 400);
    }
    // 事务外先做一次快速失败；真正生效的校验会在订单行锁内用最新数据重跑。
    await this.policy.assertRefundPolicy({
      db: this.prisma,
      order,
      amountCents: params.amountCents,
      rules: params.rules,
    });

    /*
     * 退款单先落库, 用它当**渠道幂等键** (`outRefundNo`)。
     *
     * 顺序不可反: 先调渠道再落库的话, 「渠道已受理但本地写库失败」就丢失了
     * 退款单号, 重试只能换一个新号 —— 那就是第二笔退款。
     *
     * 并发/重试保护：
     *   · 事务第一句先 no-op UPDATE 锁订单行，再重读并复跑全部退款规则；
     *     SQLite deferred transaction 只把 count 搬进事务仍会并发穿透；
     *   · 渠道调用失败、结果未知的退款单，同金额重试时**复用原 id/outRefundNo**，
     *     让渠道按退款单号幂等，而不是换一个新号再退一次；
     *   · 运营已在渠道后台确认「退款失败」的单是明确终态，重试必须新建退款单，
     *     不能拿已被渠道拒绝的退款号再次提交。
     */
    const claim = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "Order" SET "updatedAt" = "updatedAt" WHERE id = ${order.id}`;

      const fresh = await tx.order.findUnique({
        where: { id: order.id },
        include: {
          payments: {
            where: { status: 'succeeded' },
            orderBy: { createdAt: 'desc' },
          },
          refunds: {
            where: { status: 'succeeded' },
            select: {
              status: true,
              creditsReclaimed: true,
              creditsUnreclaimable: true,
              creditsExpired: true,
            },
          },
        },
      });
      if (!fresh || (fresh.status !== 'paid' && fresh.status !== 'partial_refunded')) {
        throw new AppError(40901, '订单状态已变化，无法退款，请刷新后重试', 409);
      }

      const policy = await this.policy.assertRefundPolicy({
        db: tx,
        order: fresh,
        amountCents: params.amountCents,
        rules: params.rules,
      });

      const inFlight = await tx.refund.count({
        where: { orderId: order.id, status: 'processing' },
      });
      if (inFlight > 0) {
        throw new AppError(
          40908,
          '该订单有一笔退款仍在渠道处理中，请等渠道返回结果或到商户后台确认后再操作',
          409,
        );
      }
      if (fresh.payments.length === 0) {
        throw new AppError(40901, '订单无成功支付记录, 无法退款', 409);
      }
      if (fresh.payments.length > 1) {
        throw new AppError(
          40901,
          '订单存在多笔成功支付记录，疑似重复扣款；请先在支付对账异常单中核对，禁止直接选择其中一笔退款',
          409,
        );
      }
      const payment = fresh.payments[0];
      if ((payment.channel || '').trim() === 'manual') {
        throw new AppError(
          40901,
          '手工核销订单没有真实渠道资金，不能走原路退款；需线下退款并登记凭证后人工核销',
          409,
        );
      }

      const latestFailed = await tx.refund.findFirst({
        where: {
          orderId: order.id,
          paymentId: payment.id,
          status: 'failed',
          amountCents: params.amountCents,
        },
        orderBy: { createdAt: 'desc' },
      });
      const failedDetail = latestFailed ? parseJsonObject(latestFailed.detail) : {};
      // 旧数据没有 failureKind 时只能按 unknown 处理：无法证明渠道已明确拒绝，
      // 换新退款单号可能造成第二笔退款。人工核销为 definitive 后才允许换号。
      const reusable =
        latestFailed &&
        failedDetail.failureKind !== 'definitive' &&
        failedDetail.confirmationOutcome !== 'failed'
          ? latestFailed
          : null;

      let row: Refund;
      if (reusable) {
        const reused = await tx.refund.updateMany({
          where: { id: reusable.id, orderId: order.id, status: 'failed' },
          data: {
            status: 'processing',
            reason,
            operatorId: params.operatorId,
            providerRefundId: null,
            detail: '{}',
          },
        });
        if (reused.count === 0) {
          throw new AppError(40909, '退款单状态已变化，请刷新后重试', 409);
        }
        row = await tx.refund.findUnique({ where: { id: reusable.id } });
        if (!row) throw new AppError(40909, '退款单状态已变化，请刷新后重试', 409);
      } else {
        row = await tx.refund.create({
          data: {
            orderId: order.id,
            paymentId: payment.id,
            userId: order.userId,
            amountCents: params.amountCents,
            // 积分回收要等渠道确认够不够真退了, 先记 0
            creditsReclaimed: 0,
            creditsUnreclaimable: 0,
            creditsExpired: 0,
            reason,
            operatorId: params.operatorId,
            status: 'processing',
            detail: '{}',
          },
        });
      }

      return {
        refund: row,
        payment,
        refundedCents: fresh.refundedCents,
        paidBase: policy.paidBase,
      };
    });

    const refund = claim.refund;
    const payment = claim.payment;
    const channel = (payment.channel || 'sandbox').trim();
    const channelResult = await this.gateway.refund({
      // 必须用**实际成功支付**的渠道与配置版本，不能用 Order.channel：
      // 订单上记的是最后一次发起支付的渠道，跨渠道重试后两者可能不同。
      order: {
        channel: payment.channel,
        providerConfigId: payment.providerConfigId ?? order.providerConfigId,
        providerInstanceId: payment.providerInstanceId ?? order.providerInstanceId,
      },
      orderNo: order.orderNo,
      outRefundNo: refund.id,
      amountCents: params.amountCents,
      // 微信 v3 要求同时给「原订单总额」; 历史订单 amountCents 为 0 时回落实付
      totalCents: payment.amountCents > 0 ? payment.amountCents : claim.paidBase,
      reason,
      providerRef: payment.providerRef ?? undefined,
      providerTradeNo: payment.payTransactionId ?? undefined,
    });

    if (channelResult.state === 'failed') {
      const marked = await this.prisma.refund.updateMany({
        where: { id: refund.id, status: 'processing' },
        data: {
          status: 'failed',
          providerRefundId: channelResult.providerRefundId ?? null,
          detail: JSON.stringify({
            failureKind: channelResult.failureKind,
            error: channelResult.error,
            raw: channelResult.raw ?? null,
          }),
        },
      });
      if (marked.count === 0) {
        throw new AppError(40909, '退款单状态已变化，请刷新后确认结果', 409);
      }
      this.logger.error(
        `渠道退款未完成: order=${order.id} refund=${refund.id} channel=${channel} — ${channelResult.error}`,
      );
      await this.recordRefundException({
        orderId: order.id,
        refundId: refund.id,
        merchantOrderNo: order.orderNo,
        providerId: payment.channel,
        providerTradeNo: payment.payTransactionId,
        amountCents: params.amountCents,
        currency: order.currency,
        kind: 'refund_failed',
        detail: channelResult.error ?? '渠道退款失败',
      });
      if (channelResult.failureKind === 'definitive') {
        throw new AppError(
          40901,
          `渠道明确拒绝退款：${channelResult.error}（订单状态与积分未变更，可修正原因后重试，将生成新退款单号）`,
          409,
        );
      }
      /*
       * 50302 + HTTP 502: 网络/验签/响应异常时无法确认渠道是否受理。
       * 必须复用同一退款单号重试，且文案要明确订单状态与积分未变更。
       */
      throw new AppError(
        50302,
        `退款结果未知：${channelResult.error}（订单状态与积分未变更，请用同一退款单号重试或核对渠道）`,
        502,
      );
    }

    if (channelResult.state === 'processing') {
      /*
       * 微信可能返回 PROCESSING(异步退款)。此时**不能**回收积分、不能改订单状态:
       * 渠道可能最终失败, 而我们无法自动得知 (本仓库没有退款回调端点)。
       * 退款行保持 processing, 由运营到商户后台确认后人工处理。
       */
      const marked = await this.prisma.refund.updateMany({
        where: { id: refund.id, status: 'processing' },
        data: {
          status: 'processing',
          providerRefundId: channelResult.providerRefundId ?? null,
          detail: JSON.stringify({
            note: '渠道异步处理中，需到商户后台确认',
            raw: channelResult.raw ?? null,
          }),
        },
      });
      if (marked.count === 0) {
        throw new AppError(40909, '退款单状态已变化，请刷新后确认结果', 409);
      }
      this.logger.warn(
        `渠道退款异步处理中: order=${order.id} refund=${refund.id} channel=${channel} providerRefundId=${channelResult.providerRefundId ?? '-'}`,
      );
      await this.recordRefundException({
        orderId: order.id,
        refundId: refund.id,
        merchantOrderNo: order.orderNo,
        providerId: payment.channel,
        providerTradeNo: payment.payTransactionId,
        amountCents: params.amountCents,
        currency: order.currency,
        kind: 'refund_processing',
        detail: '渠道已受理退款但仍在异步处理中，需到商户后台核销',
      });
      return {
        refundId: refund.id,
        state: 'processing' as const,
        pending: true,
        invoiceFollowUp: null,
        refundedCents: claim.refundedCents,
        fullyRefunded: false,
        membershipTerminated: false,
        creditsReclaimed: 0,
        creditsUnreclaimable: 0,
        creditsExpired: 0,
        detail: [] as Array<{ lotId: string; taken: number }>,
        message:
          '渠道已受理退款但仍在异步处理中：订单状态与积分暂未变更，请到渠道商户后台确认最终结果',
      };
    }

    // ── 渠道确认退款成功, 才开始动本地账与积分 ────────────────────
    const result = await this.recordRefundSuccess({
      refundId: refund.id,
      orderId: params.orderId,
      providerRefundId: channelResult.providerRefundId,
      operatorId: params.operatorId,
      reason,
      detail: { channelRaw: channelResult.raw ?? null },
    });
    this.credit.warnIncompleteReclaim(params.orderId, {
      reclaimed: result.creditsReclaimed,
      unreclaimable: result.creditsUnreclaimable,
      expiredUnused: result.creditsExpired,
      detail: result.detail,
    });
    return result;
  }

  /**
   * 渠道异步退款的最终人工核销。
   *
   * 本仓库尚未接退款回调，`processing` 必须由运营核对渠道商户后台后落到成功
   * 或失败。成功路径复用与同步退款完全相同的原子记账函数；失败路径只关闭
   * 退款单并保留证据，不改订单和积分。
   */
  async confirmRefund(params: {
    orderId: string;
    refundId: string;
    outcome: 'succeeded' | 'failed';
    providerRefundId?: string;
    reason: string;
    operatorId: string;
  }): Promise<RefundSettlementResult | RefundConfirmationFailure> {
    const reason = String(params.reason ?? '').trim();
    if (!reason) throw new AppError(40001, '请填写人工核销依据', 400);
    if (params.outcome !== 'succeeded' && params.outcome !== 'failed') {
      throw new AppError(40001, '请选择退款核销结果', 400);
    }

    if (params.outcome === 'succeeded') {
      const result = await this.recordRefundSuccess({
        refundId: params.refundId,
        orderId: params.orderId,
        providerRefundId: params.providerRefundId,
        operatorId: params.operatorId,
        reason,
        detail: { confirmedFromChannelConsole: true },
      });
      this.credit.warnIncompleteReclaim(params.orderId, {
        reclaimed: result.creditsReclaimed,
        unreclaimable: result.creditsUnreclaimable,
        expiredUnused: result.creditsExpired,
        detail: result.detail,
      });
      this.logger.log(
        `人工确认渠道退款成功: order=${params.orderId} refund=${params.refundId} operator=${params.operatorId}`,
      );
      await this.paymentExceptions.markRefundResolved(params.refundId, 'succeeded');
      return result;
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({
        where: { id: params.refundId },
        include: { order: { select: { id: true, refundedCents: true } } },
      });
      if (!refund || refund.orderId !== params.orderId) {
        throw new AppError(40400, '退款单不存在或不属于该订单', 404);
      }
      if (refund.status !== 'processing') {
        throw new AppError(40909, '退款单状态已变化，无法人工核销，请刷新后重试', 409);
      }

      const confirmedAt = new Date().toISOString();
      const marked = await tx.refund.updateMany({
        where: { id: refund.id, orderId: params.orderId, status: 'processing' },
        data: {
          status: 'failed',
          ...(String(params.providerRefundId ?? '').trim()
            ? { providerRefundId: String(params.providerRefundId).trim() }
            : {}),
        },
      });
      if (marked.count === 0) {
        throw new AppError(40909, '退款单状态已变化，本次未重复核销', 409);
      }
      await tx.refund.update({
        where: { id: refund.id },
        data: {
          detail: JSON.stringify({
            ...parseJsonObject(refund.detail),
            confirmationOutcome: 'failed',
            confirmedBy: params.operatorId,
            confirmedAt,
            confirmationReason: reason,
          }),
        },
      });
      return {
        refundId: refund.id,
        orderId: params.orderId,
        state: 'failed' as const,
        pending: false as const,
        refundedCents: refund.order.refundedCents,
      };
    });
    this.logger.warn(
      `人工确认渠道退款失败: order=${params.orderId} refund=${params.refundId} operator=${params.operatorId}`,
    );
    await this.paymentExceptions.markRefundResolved(params.refundId, 'failed');
    return result;
  }

  /**
   * 退款失败/异步处理中的异常单统一入口。
   *
   * 异常单必须绑定退款单，运营人工核销时才能精确回写对应记录；同一退款单
   * 的重复调用由 PaymentExceptionService 的指纹幂等吸收。
   */
  private async recordRefundException(input: {
    orderId: string;
    refundId: string;
    merchantOrderNo: string;
    providerId: string;
    providerTradeNo?: string | null;
    amountCents: number;
    currency: string;
    kind: 'refund_failed' | 'refund_processing';
    detail: string;
  }) {
    return this.paymentExceptions.recordManual({
      providerId: input.providerId,
      orderId: input.orderId,
      refundId: input.refundId,
      merchantOrderNo: input.merchantOrderNo,
      providerTradeNo: input.providerTradeNo,
      amountCents: input.amountCents,
      currency: input.currency,
      kind: input.kind,
      detail: input.detail,
      priority: 'urgent',
    });
  }

  /**
   * 渠道已确认成功后的唯一记账入口：积分扣回、退款单、订单金额与状态、
   * 会员权益终止必须处于同一个事务。同步退款和异步人工核销都走这里。
   */
  private async recordRefundSuccess(params: {
    refundId: string;
    orderId: string;
    providerRefundId?: string;
    operatorId: string;
    reason: string;
    detail?: Record<string, unknown>;
  }): Promise<RefundSettlementResult> {
    let membershipPeriodChanged = false;
    const result = await this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({
        where: { id: params.refundId },
        include: {
          order: {
            select: {
              id: true,
              status: true,
              paidCents: true,
              totalCents: true,
              refundedCents: true,
              grantedCredits: true,
              membershipPlanId: true,
            },
          },
        },
      });
      if (!refund || refund.orderId !== params.orderId) {
        throw new AppError(40400, '退款单不存在或不属于该订单', 404);
      }
      if (refund.status !== 'processing') {
        throw new AppError(40909, '退款单状态已变化，无法核销，请刷新后重试', 409);
      }

      const order = refund.order;
      if (order.status !== 'paid' && order.status !== 'partial_refunded') {
        throw new AppError(40901, '订单状态已变化，无法退款，请刷新后重试', 409);
      }
      /*
       * 会员订单必须先锁用户，再写退款/订单状态。订阅激活也是 User → Order，
       * 若这里反过来先写订单再等用户，会出现「退款持有订单等用户、激活持有用户
       * 等订单」的死锁。锁用户后，会员周期撤销与并发续费也共享同一串行化点。
       */
      if (order.membershipPlanId) {
        await this.membership.lockMembershipProjectionInTransaction(tx, refund.userId);
      }
      const paidBase =
        order.paidCents > 0
          ? order.paidCents
          : (await tx.payment.count({
                where: { orderId: order.id, status: 'succeeded', channel: 'free' },
              })) > 0
            ? 0
            : order.totalCents;
      if (refund.amountCents > paidBase - order.refundedCents) {
        throw new AppError(40909, '退款金额超出订单当前可退额度，请核对退款单', 409);
      }

      const providerRefundId =
        String(params.providerRefundId ?? '').trim() || refund.providerRefundId || null;
      const won = await tx.refund.updateMany({
        where: { id: refund.id, orderId: order.id, status: 'processing' },
        data: { status: 'succeeded', providerRefundId },
      });
      if (won.count === 0) {
        throw new AppError(40909, '退款单状态已变化，本次未重复记账', 409);
      }

      const refundedCents = order.refundedCents + refund.amountCents;
      /*
       * 部分退款按累计已退金额比例回收积分，而不是只看是否首笔退款。
       * 用累计目标减去历史已记账份额，既保证多次部分退款总和不超过发放量，
       * 也兼容旧数据中已提前回收整单历史记录，避免二次扣回。
       */
      const previousCredits = await tx.refund.aggregate({
        where: { orderId: order.id, status: 'succeeded', id: { not: refund.id } },
        _sum: { creditsReclaimed: true, creditsUnreclaimable: true, creditsExpired: true },
      });
      const accountedCredits =
        (previousCredits._sum.creditsReclaimed ?? 0) +
        (previousCredits._sum.creditsUnreclaimable ?? 0) +
        (previousCredits._sum.creditsExpired ?? 0);
      const cumulativeCreditTarget =
        paidBase > 0
          ? Number((BigInt(order.grantedCredits) * BigInt(refundedCents)) / BigInt(paidBase))
          : 0;
      const creditsToReclaim = Math.max(0, cumulativeCreditTarget - accountedCredits);
      const credits =
        creditsToReclaim > 0
          ? await this.credit.reclaimForOrderInTransaction(
              tx,
              order.id,
              params.operatorId,
              params.reason,
              creditsToReclaim,
            )
          : { reclaimed: 0, unreclaimable: 0, expiredUnused: 0, detail: [] };
      const fullyRefunded = refundedCents >= paidBase;
      const bumped = await tx.order.updateMany({
        where: { id: order.id, refundedCents: order.refundedCents },
        data: { refundedCents },
      });
      if (bumped.count === 0) {
        throw new AppError(40909, '订单已退金额已变化，请刷新后重试', 409);
      }
      await this.transition(order.id, fullyRefunded ? 'refunded' : 'partial_refunded', tx);

      const membershipRevocation =
        fullyRefunded && order.membershipPlanId
          ? await this.membership.revokeOrderPeriodInTransaction(tx, order.id)
          : null;
      membershipPeriodChanged = membershipRevocation?.affected ?? false;
      const membershipTerminated = membershipRevocation?.terminated ?? false;

      const confirmedAt = new Date().toISOString();
      await tx.refund.update({
        where: { id: refund.id },
        data: {
          creditsReclaimed: credits.reclaimed,
          creditsUnreclaimable: credits.unreclaimable,
          creditsExpired: credits.expiredUnused,
          detail: JSON.stringify({
            ...parseJsonObject(refund.detail),
            ...(params.detail ?? {}),
            credits: credits.detail,
            ...(membershipRevocation ? { membership: membershipRevocation } : {}),
            confirmedBy: params.operatorId,
            confirmedAt,
            confirmationReason: params.reason,
          }),
        },
      });
      const invoice = await tx.invoice.findFirst({
        where: { orderId: order.id, status: { in: ['pending', 'issued'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, invoiceNo: true, status: true, amountCents: true },
      });
      const invoiceFollowUp = this.invoiceFollowUp(invoice, paidBase - refundedCents);
      if (membershipRevocation?.affected) {
        this.logger.log(
          membershipTerminated
            ? `会员订单全额退款, 已终止会员: order=${order.id}`
            : `会员订单全额退款, 已撤销对应周期并保留其他已付周期: order=${order.id} remaining=${membershipRevocation.remainingExpiresAt ?? '-'}`,
        );
      }
      return {
        refundId: refund.id,
        state: 'succeeded' as const,
        pending: false as const,
        refundedCents,
        fullyRefunded,
        membershipTerminated,
        creditsReclaimed: credits.reclaimed,
        creditsUnreclaimable: credits.unreclaimable,
        creditsExpired: credits.expiredUnused,
        detail: credits.detail,
        invoiceFollowUp,
      };
    });
    if (membershipPeriodChanged) {
      await this.membership.invalidateUserGroupCatalog();
    }
    return result;
  }

  /** 退款成功后，把仍需人工处理的发票从响应里显式带回，不能只存库等运营发现。 */
  private invoiceFollowUp(
    invoice: {
      id: string;
      invoiceNo: string;
      status: string;
      amountCents: number;
    } | null,
    invoiceableCents: number,
  ): RefundInvoiceFollowUp | null {
    if (!invoice || (invoice.status !== 'pending' && invoice.status !== 'issued')) {
      return null;
    }
    // 待开发票的金额是申请时快照。只有退款后余额低于票面时才必须驳回；
    // 若仍足以覆盖原票面，退款本身不需要运营额外处理。
    if (invoice.status === 'pending' && invoice.amountCents <= invoiceableCents) {
      return null;
    }
    return {
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      status: invoice.status,
      message:
        invoice.status === 'pending'
          ? `订单存在待开具发票 ${invoice.invoiceNo}，票面 ${invoice.amountCents} 分超过退款后剩余可开票金额 ${Math.max(invoiceableCents, 0)} 分；请到发票管理驳回该申请。`
          : `订单存在已开具发票 ${invoice.invoiceNo}；请在线下税务平台完成冲红，并在发票管理登记冲红。`,
    };
  }

  private transition(
    orderId: string,
    to: OrderStatus,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    return transitionOrder(tx ?? this.prisma, orderId, to);
  }
}

export type RefundParams = Parameters<OrderRefundService['refund']>[0];
export type ConfirmRefundParams = Parameters<OrderRefundService['confirmRefund']>[0];
