import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { CreditService } from '../credits/credit.service';
import { MembershipService } from '../membership/membership.service';
import { MarketingService } from '../marketing/marketing.service';

/**
 * 订单与沙箱支付 (admin-prd.md §3.7 B-39~B-44 / M8)。
 *
 * 状态机 (PRD §5: **不可跳跃**):
 *
 *   pending ──支付成功──> paid ──全额退款──> refunded
 *      │                   │
 *      │                   └──部分退款──> partial_refunded ──再退──> refunded
 *      └──超时/取消──> cancelled
 *
 *   cancelled / refunded 是终态, 不可回退。任何试图跳跃的调用返回 409。
 *
 * 幂等 (PRD §5):
 *   · 下单按 (userId, idempotencyKey) 去重, 重复请求返回同一订单
 *   · 回调按 payTransactionId 去重, **已支付订单收到重复回调不重复发积分**
 */

export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'refunded' | 'partial_refunded';

/** 订单未支付自动关闭时限: 30 分钟 */
const ORDER_TTL_MINUTES = 30;

/** 允许的状态迁移。key 是当前状态, value 是允许迁移到的状态 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['refunded', 'partial_refunded'],
  partial_refunded: ['refunded', 'partial_refunded'],
  refunded: [],
  cancelled: [],
};

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credit: CreditService,
    private readonly marketing: MarketingService,
    private readonly membership: MembershipService,
  ) {}

  // ── 下单 ──────────────────────────────────────────────────────────

  /**
   * 创建订单 (幂等)。
   *
   * 幂等实现: 数据库唯一约束 (userId, idempotencyKey) + 冲突后查回既有订单。
   * 先查后插会有竞态(两个请求同时查不到), 靠唯一约束兜底才是可靠的。
   *
   * 优惠 (M11): 券与限时活动**不叠加, 取更优者** (admin-detailed-design.md §12.6),
   * 结果连同**规则快照**一起落库 —— 事后改券价或活动到期都不影响历史订单。
   *
   * ⚠ 优惠**不即时核销**: Coupon.usedCount 只在支付成功时 +1。
   * 下单即计数会让用户反复下单不付款就能把限量券耗光。
   */
  async create(params: {
    userId: string;
    items: Array<{ productId: string; quantity: number }>;
    idempotencyKey: string;
    couponCode?: string | null;
    campaignIds?: string[];
  }) {
    if (!params.idempotencyKey) {
      throw new AppError(40001, '缺少幂等键', 400);
    }
    if (params.items.length === 0) {
      throw new AppError(40001, '订单不能为空', 400);
    }

    // 幂等命中: 直接返回既有订单, 不重复创建
    const existing = await this.prisma.order.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: params.userId,
          idempotencyKey: params.idempotencyKey,
        },
      },
      include: this.orderInclude(),
    });
    if (existing) {
      return { ...this.toOrderView(existing), idempotentHit: true };
    }

    // 校验并组装商品快照
    const products = await this.prisma.product.findMany({
      where: { id: { in: params.items.map((i) => i.productId) } },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    /*
     * 会员加油包折扣 (落地页承诺「加油包会员专享95 折」)。
     *
     * 折扣在**汇总商品金额后、快照之前**应用 —— 顺序错了会导致
     * 订单快照里记的是折前价, 退款时按折前价退, 平台自亏。
     * 同时订阅购买本身不走折扣(见 MembershipService.quoteOrder)。
     */
    /*
     * 会员加油包折扣 (落地页承诺「加油包会员专享95 折」)。
     *
     * 折扣在**汇总商品金额后、快照之前**应用 —— 顺序错了会导致
     * 订单快照里记的是折前价, 退款时按折前价退, 平台自亏。
     * 同时订阅购买本身不走折扣(见 MembershipService.quoteOrder)。
     */
    let totalCents = 0;
    let totalCredits = 0;
    const settleItems: Array<{ productId: string; priceCents: number; quantity: number }> = [];
    const snapshots = params.items.map((item) => {
      const p = byId.get(item.productId);
      if (!p) throw new AppError(40400, `商品不存在: ${item.productId}`, 404);
      if (p.status !== 'active') {
        throw new AppError(40001, `商品已下架: ${p.name}`, 400);
      }
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        throw new AppError(40001, '数量必须为正整数', 400);
      }
      totalCents += p.priceCents * item.quantity;
      totalCredits += p.credits * item.quantity;
      settleItems.push({ productId: p.id, priceCents: p.priceCents, quantity: item.quantity });
      return {
        productId: p.id,
        skuSnapshot: p.sku,
        nameSnapshot: p.name,
        priceCentsSnapshot: p.priceCents,
        creditsSnapshot: p.credits,
        validDaysSnapshot: p.creditsValidDays,
        quantity: item.quantity,
      };
    });

    // 汇总完成后再套会员折扣
    const quote = await this.membership.quoteOrder(params.userId, totalCents, {
      isSubscription: false,
    });
    const membershipPlan = quote.planCode
      ? await this.prisma.membershipPlan.findFirst({ where: { code: quote.planCode } })
      : null;
    totalCents = quote.finalCents;

    const expiresAt = new Date(Date.now() + ORDER_TTL_MINUTES * 60 * 1000);

    /*
     * 优惠计算。券不可用时**不阻断下单** —— 券是附加优惠而非下单前提,
     * 用户输错码不该连单都下不了。降级为不打折, 原因随订单返回供前端提示。
     */
    const discount = await this.marketing.settleDiscount({
      userId: params.userId,
      items: settleItems,
      couponCode: params.couponCode ?? null,
      campaignIds: params.campaignIds,
    });
    const discountCents = Math.min(discount.discountCents, totalCents);
    const paidCents = totalCents - discountCents;

    try {
      const order = await this.prisma.order.create({
        data: {
          orderNo: this.genOrderNo(),
          userId: params.userId,
          idempotencyKey: params.idempotencyKey,
          totalCents,
          discountCents,
          paidCents,
          couponId: discount.couponId,
          campaignId: discount.campaignId,
          // 快照落库: 事后改券/活动到期都不影响本单金额的可解释性
          couponSnapshot: JSON.stringify(discount.snapshot),
          grantedCredits: 0, // 支付成功后才确定
          expiresAt,
          items: { create: snapshots },
        },
        include: this.orderInclude(),
      });
      return {
        ...this.toOrderView(order),
        idempotentHit: false,
        // 券不可用的原因原样透出, 前端在结算页提示, 不必再发一次请求
        couponWarning: (discount.snapshot as any)?.couponWarning ?? null,
      };
    } catch (e) {
      // 唯一约束冲突 = 并发下的幂等重复提交, 查回既有订单而不是报错
      const dup = await this.prisma.order.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: params.userId,
            idempotencyKey: params.idempotencyKey,
          },
        },
        include: this.orderInclude(),
      });
      if (dup) return { ...this.toOrderView(dup), idempotentHit: true };
      throw e;
    }
  }

  /** 订单详情 */
  async detail(orderId: string, userId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: this.orderInclude(),
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);
    // 传了 userId 就是C 端查询, 必须校验归属
    if (userId && order.userId !== userId) {
      throw new AppError(40301, '无权查看该订单', 403);
    }
    return this.toOrderView(order);
  }

  /** C 端订单列表 */
  async listByUser(userId: string, limit = 20) {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: this.orderInclude(),
    });
    return orders.map((o) => this.toOrderView(o));
  }

  // ── 沙箱支付 ──────────────────────────────────────────────────────

  /**
   * 沙箱支付 (M8)。
   *
   * 模拟三种场景, 让前端能完整走通购买流程而无需商户号:
   *   'success' 支付成功 → 发积分
   *   'failed'  支付失败 → 订单保持 pending, 可重新支付
   *   'timeout' 支付超时 → 订单转cancelled
   *
   * ⚠ **沙箱不产生真实资金流转**, 仅用于开发联调。真实通道见 M15。
   */
  async sandboxPay(params: {
    orderId: string;
    userId: string;
    scenario: 'success' | 'failed' | 'timeout';
  }) {
    const order = await this.prisma.order.findUnique({
      where: { id: params.orderId },
      include: this.orderInclude(),
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);
    if (order.userId !== params.userId) {
      throw new AppError(40301, '无权支付该订单', 403);
    }

    // 已支付的订单重复支付 → 幂等返回, 不重复发积分
    if (order.status === 'paid') {
      return { order: this.toOrderView(order), idempotentHit: true, message: '订单已支付' };
    }
    if (order.status !== 'pending') {
      throw new AppError(40901, `订单当前状态不可支付: ${order.status}`, 409);
    }
    // 超时订单不可再支付
    if (new Date() > order.expiresAt) {
      await this.transition(order.id, 'cancelled');
      throw new AppError(40901, '订单已超时关闭', 409);
    }

    const transactionId = `SBX-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (params.scenario === 'timeout') {
      await this.prisma.payment.create({
        data: {
          orderId: order.id,
          userId: params.userId,
          payTransactionId: transactionId,
          amountCents: order.paidCents,
          status: 'failed',
          message: '沙箱模拟: 支付超时',
          sandboxScenario: 'timeout',
        },
      });
      await this.transition(order.id, 'cancelled');
      const updated = await this.detail(order.id);
      return { order: updated, idempotentHit: false, message: '支付超时, 订单已关闭' };
    }

    if (params.scenario === 'failed') {
      await this.prisma.payment.create({
        data: {
          orderId: order.id,
          userId: params.userId,
          payTransactionId: transactionId,
          amountCents: order.paidCents,
          status: 'failed',
          message: '沙箱模拟: 支付失败',
          sandboxScenario: 'failed',
        },
      });
      // 订单保持 pending —— 允许用户重新支付
      return {
        order: this.toOrderView(order),
        idempotentHit: false,
        message: '支付失败, 可重新发起支付',
      };
    }

    // success
    return this.markPaid({
      orderId: order.id,
      userId: params.userId,
      payTransactionId: transactionId,
      channel: 'sandbox',
      sandboxScenario: 'success',
    });
  }

  /**
   * 标记订单已支付并发积分 (M15 真实回调也走这里)。
   *
   * 幂等保证 (PRD §5「幂等回调」):
   *   1. payTransactionId 唯一 —— 重复回调不产生新流水
   *   2. 订单已是 paid → 直接返回, **不重复发积分**
   *   3. 发积分与订单状态变更在同一事务 —— 不会出现"订单已支付但积分没发"
   */
  async markPaid(params: {
    orderId: string;
    userId: string;
    payTransactionId: string;
    channel: string;
    sandboxScenario?: string;
  }) {
    // 1) 交易号已存在 = 重复回调
    const dupPayment = await this.prisma.payment.findUnique({
      where: { payTransactionId: params.payTransactionId },
    });
    if (dupPayment) {
      const order = await this.detail(params.orderId);
      return { order, idempotentHit: true, message: '重复回调, 已忽略' };
    }

    const order = await this.prisma.order.findUnique({
      where: { id: params.orderId },
      include: this.orderInclude(),
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);

    // 2) 订单已支付 → 幂等返回, 不重复发积分
    if (order.status === 'paid') {
      return { order: this.toOrderView(order), idempotentHit: true, message: '订单已支付' };
    }
    if (order.status !== 'pending') {
      throw new AppError(40901, `订单当前状态不可支付: ${order.status}`, 409);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          orderId: order.id,
          userId: params.userId,
          payTransactionId: params.payTransactionId,
          channel: params.channel,
          // 流水金额记**实付**, 不是订单原价。记原价会让对账看起来"收了全价",
          // 而用户实际少付了优惠部分 —— 财务对账时这个差额无法解释
          amountCents: order.paidCents,
          status: 'succeeded',
          paidAt: new Date(),
          sandboxScenario: params.sandboxScenario,
        },
      });

      const updated = await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'paid',
          paidAt: new Date(),
          grantedCredits: order.items.reduce((s, i) => s + i.creditsSnapshot * i.quantity, 0),
        },
      });

      // 发放方式: manual 的商品由后台手动发放, 不自动发
      const needsAutoGrant = order.items.some((i) => i.productId.length > 0);
      if (needsAutoGrant) {
        for (const item of order.items) {
          const product = await tx.product.findUnique({ where: { id: item.productId } });
          if (product?.grantType === 'manual') continue;
          await this.credit.grant({
            userId: params.userId,
            credits: item.creditsSnapshot * item.quantity,
            source: 'purchase',
            validDays: item.validDaysSnapshot,
            orderId: order.id,
          });
        }
      }
      void updated;
    });

    /*
     * 营销副作用放在事务**之外**。
     *
     * 理由: 券核销与邀请发奖都是独立的资源变更, 若放进同一事务, 失败会连带
     * 回滚"支付成功"这一既成事实 —— 钱收了但订单回到 pending, 是更糟的状态。
     * 两者自身都有幂等闸 (条件更新), 重复执行安全。
     */
    try {
      if (order.couponId) {
        await this.marketing.redeemCoupon(order.couponId, order.id);
      }
      await this.marketing.onOrderPaid(params.userId);
    } catch (e: any) {
      // 营销副作用失败**不得影响支付结果**: 记WARN 并继续返回成功
      this.logger.warn(`营销副作用执行失败 (订单 ${order.orderNo}): ${e?.message ?? e}`);
    }

    /*
     * 记录会员优惠。
     *
     * ⚠ 只在**支付成功后**记 —— 未支付就记会虚增「累计省了多少」。
     * 优惠额从订单的 membershipPlanId 反查, 不依赖下单时的局部变量:
     * 折前金额已存在 Order.totalCents, 折后即实付 paidCents, 差值即节省额。
     */
    if (order.membershipPlanId) {
      const plan = await this.prisma.membershipPlan.findUnique({
        where: { id: order.membershipPlanId },
        select: { code: true },
      });
      if (plan) {
        const savedCents = Math.max(0, order.totalCents - order.paidCents);
        await this.membership.recordUsage(params.userId, order.id, savedCents, plan.code);
      }
    }

    const updated = await this.detail(params.orderId);
    return { order: updated, idempotentHit: false, message: '支付成功' };
  }

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
  }) {
    const reason = params.reason?.trim();
    if (!reason) throw new AppError(40001, '退款必须填写原因', 400);

    const order = await this.prisma.order.findUnique({
      where: { id: params.orderId },
      include: this.orderInclude(),
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);
    if (order.status !== 'paid' && order.status !== 'partial_refunded') {
      throw new AppError(40901, `订单当前状态不可退款: ${order.status}`, 409);
    }
    if (params.amountCents <= 0) {
      throw new AppError(40001, '退款金额必须大于 0', 400);
    }
    /*
     * 可退上限 = **实付** - 已退, 不是订单原价。
     *
     * ⚠ 用原价会导致直接资损: 100 元订单用了 30 元券, 实付 70 元, 却能退 100 元。
     * 兼容无优惠的历史订单: paidCents 为 0 时回落 totalCents (旧数据未回填该字段)。
     */
    const paidBase = order.paidCents > 0 ? order.paidCents : order.totalCents;
    const refundable = paidBase - order.refundedCents;
    if (params.amountCents > refundable) {
      throw new AppError(40001, `退款金额超出可退: 最多 ${refundable} 分`, 400);
    }

    const payment = order.payments.find((p) => p.status === 'succeeded');
    if (!payment) throw new AppError(40901, '订单无成功支付记录, 无法退款', 409);

    // 首次退款才扣积分; 部分退款的二次调用不应重复扣
    const firstRefund = order.refundedCents === 0;
    let reclaimed = { reclaimed: 0, unreclaimable: 0, detail: [] as Array<{ lotId: string; taken: number }> };
    if (firstRefund) {
      reclaimed = await this.credit.reclaimForOrder(params.orderId, params.operatorId, reason);
    }

    const refundedCents = order.refundedCents + params.amountCents;
    // 全额判定同样以实付为基准: 否则用券订单永远退不满, 会卡在 partial_refunded
    const fullyRefunded = refundedCents >= paidBase;

    const refund = await this.prisma.refund.create({
      data: {
        orderId: order.id,
        paymentId: payment.id,
        userId: order.userId,
        amountCents: params.amountCents,
        creditsReclaimed: reclaimed.reclaimed,
        creditsUnreclaimable: reclaimed.unreclaimable,
        reason,
        operatorId: params.operatorId,
        detail: JSON.stringify(reclaimed.detail),
      },
    });

    await this.transition(order.id, fullyRefunded ? 'refunded' : 'partial_refunded');
    await this.prisma.order.update({
      where: { id: order.id },
      data: { refundedCents },
    });

    return {
      refundId: refund.id,
      refundedCents,
      fullyRefunded,
      creditsReclaimed: reclaimed.reclaimed,
      creditsUnreclaimable: reclaimed.unreclaimable,
      detail: reclaimed.detail,
    };
  }

  // ── 状态机 ────────────────────────────────────────────────────────

  /** 校验并执行状态迁移。非法迁移抛 409, 绝不静默通过 */
  async transition(orderId: string, to: OrderStatus): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);

    const allowed = TRANSITIONS[order.status as OrderStatus] ?? [];
    if (!allowed.includes(to)) {
      throw new AppError(
        40901,
        `订单状态不可从 ${order.status} 变更为 ${to} (允许: ${allowed.join('/') || '无'})`,
        409,
      );
    }
    await this.prisma.order.update({ where: { id: orderId }, data: { status: to } });
  }

  /** 超时未支付订单自动关闭 (M9.5 调度器) */
  async cancelExpired(): Promise<number> {
    const due = await this.prisma.order.findMany({
      where: { status: 'pending', expiresAt: { lte: new Date() } },
      select: { id: true },
      take: 200,
    });
    for (const o of due) {
      await this.prisma.order
        .update({ where: { id: o.id }, data: { status: 'cancelled' } })
        .catch(() => undefined);
    }
    if (due.length) this.logger.log(`超时订单自动关闭: ${due.length} 笔`);
    return due.length;
  }

  // ── 内部 ──────────────────────────────────────────────────────────

  private orderInclude() {
    return {
      /*
       * ⚠ 不要把 membershipPlanId 写进 include —— 它是标量不是关联,
       * Prisma 会抛 `include statements only accept relation fields`。
       * 标量默认就在查询结果里, 不需要显式声明。
       */
      items: true,
      payments: { orderBy: { createdAt: 'desc' as const } },
      refunds: { orderBy: { createdAt: 'desc' as const } },
      user: { select: { id: true, email: true, name: true } },
      // 券可能事后被改价/停用, 但订单要显示"当时用的是哪张券" —— 取快照而非实时值
      coupon: { select: { code: true, name: true } },
      campaign: { select: { id: true, name: true } },
    };
  }

  /** 订单号: 时间戳 + 随机段, 人工可读且不重复 */
  private genOrderNo(): string {
    const d = new Date();
    const stamp = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
      String(d.getHours()).padStart(2, '0'),
      String(d.getMinutes()).padStart(2, '0'),
      String(d.getSeconds()).padStart(2, '0'),
    ].join('');
    return `HJ${stamp}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  }

  private toOrderView(o: any) {
    return {
      id: o.id,
      orderNo: o.orderNo,
      userId: o.userId,
      userEmail: o.user?.email ?? '',
      status: o.status,
      channel: o.channel,
      totalCents: o.totalCents,
      discountCents: o.discountCents ?? 0,
      // 旧订单无 paidCents 字段值时回落原价, 避免展示为 0 元
      paidCents: o.paidCents > 0 ? o.paidCents : o.totalCents,
      refundedCents: o.refundedCents,
      couponId: o.couponId ?? null,
      couponCode: o.coupon?.code ?? null,
      couponName: o.coupon?.name ?? null,
      campaignId: o.campaignId ?? null,
      grantedCredits: o.grantedCredits,
      paidAt: o.paidAt,
      expiresAt: o.expiresAt,
      createdAt: o.createdAt,
      items: (o.items ?? []).map((i: any) => ({
        id: i.id,
        productId: i.productId,
        sku: i.skuSnapshot,
        name: i.nameSnapshot,
        priceCents: i.priceCentsSnapshot,
        credits: i.creditsSnapshot,
        validDays: i.validDaysSnapshot,
        quantity: i.quantity,
      })),
      payments: (o.payments ?? []).map((p: any) => ({
        id: p.id,
        payTransactionId: p.payTransactionId,
        channel: p.channel,
        amountCents: p.amountCents,
        status: p.status,
        message: p.message,
        sandboxScenario: p.sandboxScenario,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
      })),
      refunds: (o.refunds ?? []).map((r: any) => ({
        id: r.id,
        amountCents: r.amountCents,
        creditsReclaimed: r.creditsReclaimed,
        creditsUnreclaimable: r.creditsUnreclaimable,
        reason: r.reason,
        createdAt: r.createdAt,
      })),
    };
  }
}