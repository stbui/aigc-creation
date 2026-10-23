import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { CreditService } from '../credits/credit.service';
import { MembershipService } from '../membership/membership.service';
import { MarketingService } from '../marketing/marketing.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentProviderFactory } from '../payments/payment.factory';
import type { PaymentRefundResult } from '../payments/payment-provider.interface';

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

/**
 * 退款规则快照 (B8)。
 *
 * 由调用方（后台控制器）从 `AdminSettingsService.refundRules()` 取好再传入 ——
 * OrdersModule 不依赖 admin 层, 规则键名只在一处（`settings.dto.ts`）定义。
 */
export interface RefundRules {
  /** 支付后多少天内可退, 0 = 不限 */
  windowDays: number;
  /** 可退金额上限占实付的万分比, 10000 = 全额 */
  maxRatioBps: number;
  /** 是否允许积分已被消耗的订单退款 */
  allowConsumedTask: boolean;
}

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
    private readonly notifications: NotificationsService,
    /**
     * 支付通道工厂（2026-10-22）。
     *
     * 退款必须真的打回渠道, 故订单域要能拿到通道实现。依赖的是
     * `PaymentCoreModule`（只含这个无依赖的工厂）, 不是 `PaymentsModule` ——
     * 后者反过来 import 了本模块, 直接依赖只是把循环依赖藏起来。
     */
    private readonly paymentFactory: PaymentProviderFactory,
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
    /** 商品项。与 membershipPlanId **互斥** (同时给直接 400, 不做隐式取舍) */
    items?: Array<{ productId: string; quantity: number }>;
    /** 会员套餐 id。会员单金额取套餐价, 不建 OrderItem */
    membershipPlanId?: string | null;
    idempotencyKey: string;
    couponCode?: string | null;
    campaignIds?: string[];
  }) {
    const items = params.items ?? [];
    const isMembershipOrder = !!params.membershipPlanId;

    if (!params.idempotencyKey) {
      throw new AppError(40001, '缺少幂等键', 400);
    }
    if (isMembershipOrder && items.length > 0) {
      throw new AppError(40001, '会员套餐与积分商品不能混在同一订单中购买', 400);
    }
    if (!isMembershipOrder && items.length === 0) {
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

    let totalCents = 0;
    let discountCents = 0;
    let paidCents = 0;
    let couponId: string | null = null;
    let campaignId: string | null = null;
    let couponSnapshot: Record<string, unknown> = {};
    let couponWarning: string | null = null;
    let snapshots: Array<{
      productId: string;
      skuSnapshot: string;
      nameSnapshot: string;
      priceCentsSnapshot: number;
      creditsSnapshot: number;
      validDaysSnapshot: number;
      quantity: number;
    }> = [];

    if (isMembershipOrder) {
      /*
       * ── 会员订阅单 ──
       *
       * 金额 = 套餐价**原价**, 不套任何优惠:
       *   · 不套会员加油包折扣 —— 否则等于"用会员折扣买会员", 可无限套利
       *     (见 MembershipService.quoteOrder 的 isSubscription 分支)
       *   · 不叠加券与限时活动 —— 订阅价是权益定价, 不是商品促销价;
       *     混进来会让「会员原价」这个数字在不同人手里不一样, 续费口径无法解释
       *
       * 传了券**不报错但如实提示**: 与商品单「券不可用不阻断下单」同一口径,
       * 静默丢掉才是更糟的 —— 用户会以为折扣已经生效。
       */
      const plan = await this.prisma.membershipPlan.findUnique({
        where: { id: params.membershipPlanId! },
      });
      if (!plan) throw new AppError(40400, '会员套餐不存在', 404);
      if (plan.status !== 'active') throw new AppError(40001, '该套餐已下架', 400);
      if (plan.durationDays <= 0) throw new AppError(40001, '默认套餐不支持购买', 400);
      if (plan.priceCents <= 0) throw new AppError(40001, '套餐价格异常, 暂不可购买', 400);

      totalCents = plan.priceCents;
      paidCents = plan.priceCents;
      if (params.couponCode) {
        couponWarning = '会员订阅不支持优惠券与限时活动, 已按套餐原价下单';
      }
      couponSnapshot = { kind: 'membership', planCode: plan.code, couponWarning };
    } else {
      // ── 商品单 (积分包 / 套餐) ──
      const products = await this.prisma.product.findMany({
        where: { id: { in: items.map((i) => i.productId) } },
      });
      const byId = new Map(products.map((p) => [p.id, p]));

      /*
       * 会员加油包折扣 (落地页承诺「加油包会员专享95 折」)。
       *
       * 折扣在**汇总商品金额后、快照之前**应用 —— 顺序错了会导致
       * 订单快照里记的是折前价, 退款时按折前价退, 平台自亏。
       * 同时订阅购买本身不走折扣(见 MembershipService.quoteOrder)。
       */
      const settleItems: Array<{ productId: string; priceCents: number; quantity: number }> = [];
      snapshots = items.map((item) => {
        const p = byId.get(item.productId);
        if (!p) throw new AppError(40400, `商品不存在: ${item.productId}`, 404);
        if (p.status !== 'active') {
          throw new AppError(40001, `商品已下架: ${p.name}`, 400);
        }
        if (!Number.isInteger(item.quantity) || item.quantity < 1) {
          throw new AppError(40001, '数量必须为正整数', 400);
        }
        totalCents += p.priceCents * item.quantity;
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
      totalCents = quote.finalCents;

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
      discountCents = Math.min(discount.discountCents, totalCents);
      paidCents = totalCents - discountCents;
      couponId = discount.couponId;
      campaignId = discount.campaignId;
      // 快照落库: 事后改券/活动到期都不影响本单金额的可解释性
      couponSnapshot = discount.snapshot as Record<string, unknown>;
      couponWarning = (discount.snapshot as any)?.couponWarning ?? null;
    }

    const expiresAt = new Date(Date.now() + ORDER_TTL_MINUTES * 60 * 1000);

    try {
      const order = await this.prisma.order.create({
        data: {
          orderNo: this.genOrderNo(),
          userId: params.userId,
          idempotencyKey: params.idempotencyKey,
          totalCents,
          discountCents,
          paidCents,
          couponId,
          campaignId,
          couponSnapshot: JSON.stringify(couponSnapshot),
          grantedCredits: 0, // 支付成功后才确定
          expiresAt,
          // 会员单不带 OrderItem: 它买的不是"多少积分", 而是一段权益周期
          membershipPlanId: isMembershipOrder ? params.membershipPlanId! : null,
          ...(snapshots.length > 0 ? { items: { create: snapshots } } : {}),
        },
        include: this.orderInclude(),
      });
      return {
        ...this.toOrderView(order),
        idempotentHit: false,
        // 券不可用的原因原样透出, 前端在结算页提示, 不必再发一次请求
        couponWarning,
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
    /*
     * 站内模拟支付只允许「非生产 + 沙箱通道」。
     *
     * 这个端点直接调 markPaid，等于绕过渠道回调把订单置为已支付。一旦
     * PAYMENT_PROVIDER 配成 alipay/wechat，任何登录用户对自己的 pending 单
     * POST 一次就能免费拿积分/会员；生产环境更不该存在这条路径。
     * 按「不存在」处理（404），不对外暴露端点存在性。
     */
    const configuredProvider = process.env.PAYMENT_PROVIDER || 'sandbox';
    if (process.env.NODE_ENV === 'production' || configuredProvider !== 'sandbox') {
      throw new AppError(40400, '订单不存在', 404);
    }

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
    /** 渠道原始回调报文 (真实通道; 沙箱为空)。只落库, 不进接口响应 */
    rawPayload?: string;
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
          rawPayload: params.rawPayload ?? '',
        },
      });

      /*
       * 本单会发放的积分总额 = 商品批次积分 + 会员首期积分。
       *
       * 会员单没有 OrderItem, 它的积分由 MembershipService.subscribe 发放;
       * 但 `grantedCredits` 必须在这里就记全 —— 退款回收 (`reclaimForOrder`)
       * 正是按这个快照扣的, 记 0 会让「退了会员钱、积分还在」。
       */
      const membershipCredits = order.membershipPlanId
        ? (
            await tx.membershipPlan.findUnique({
              where: { id: order.membershipPlanId },
              select: { monthlyCredits: true },
            })
          )?.monthlyCredits ?? 0
        : 0;

      /*
       * `grantedCredits` 必须等于**实际自动发放的积分**。
       *
       * manual 商品由后台手工发放，不走自动发放；若这里仍按全部 OrderItem
       * 累加，退款回收 (`reclaimForOrder`) 会以这个虚高快照为上限，从用户
       * 其它批次里扣走从未到账的积分。先决定哪些条目会发，再累加。
       */
      const autoGrantItems: typeof order.items = [];
      let grantedCredits = membershipCredits;
      for (const item of order.items) {
        const product = item.productId
          ? await tx.product.findUnique({ where: { id: item.productId } })
          : null;
        if (product?.grantType === 'manual') continue;
        autoGrantItems.push(item);
        grantedCredits += item.creditsSnapshot * item.quantity;
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'paid',
          paidAt: new Date(),
          grantedCredits,
        },
      });

      for (const item of autoGrantItems) {
        await this.credit.grant({
          userId: params.userId,
          credits: item.creditsSnapshot * item.quantity,
          source: 'purchase',
          validDays: item.validDaysSnapshot,
          orderId: order.id,
        });
      }
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
     * 会员订阅单: 支付成功后**激活会员**。
     *
     * 权益发放放在事务之外、用订单上的 `membershipAppliedAt` 做一次性闸门:
     *   · 事务里发权益会连带回滚"支付成功"这一既成事实 (钱收了, 订单回 pending)
     *   · 闸门必须是订单字段而非 Membership.orderId —— 续费会复用同一行会员并
     *     覆盖 orderId, 旧订单因此"看起来没被用过", 重放就能再白拿一期
     *
     * 失败时闸门开回去并记 ERROR, 由调度任务重试 (retryPendingMembershipActivation)。
     */
    if (order.membershipPlanId) {
      await this.activateMembership(order.id);
    }

    const updated = await this.detail(params.orderId);

    /*
     * 站内通知 (B4)。读 `updated` 而不是事务前的 `order`:
     * 发放积分是在事务里改的, 用旧对象会报出 0 积分。
     * 通知写失败只记 WARN, 绝不能让「钱已收到」的响应变成错误。
     */
    await this.notifications.notify({
      userId: params.userId,
      type: 'payment_success',
      vars: {
        orderNo: updated.orderNo,
        amount: (updated.paidCents / 100).toFixed(2),
        credits: updated.grantedCredits ?? 0,
      },
      fallbackTitle: '支付成功',
      fallbackBody: `订单 ${updated.orderNo} 已支付 ¥${(updated.paidCents / 100).toFixed(2)}。`,
      link: updated.membershipPlanId ? '/packages' : '/credits',
    });

    return { order: updated, idempotentHit: false, message: '支付成功' };
  }

  /**
   * 激活会员订单的权益 (幂等)。
   *
   * ⚠ 一次性闸门**只在 `MembershipService.subscribe` 的事务里**:
   * 它用 `updateMany({ membershipAppliedAt: null })` 抢锁, 与「延期 + 发积分」
   * 同属一个事务, 抢不到就整笔跳过。
   *
   * 这里**不能**再抢一次 —— 曾经在这里先抢、再调 subscribe, 结果是
   * subscribe 看到闸门已被本方法置上, 判定"已兑换", 于是订单标记为已发放
   * 而会员与积分一个都没到账。加锁点只能有一个。
   *
   * @returns 'applied' 本次完成激活 | 'already' 已激活过 | 'failed' 失败待重试
   */
  private async activateMembership(orderId: string): Promise<'applied' | 'already' | 'failed'> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true, membershipPlanId: true },
    });
    if (!order?.membershipPlanId) return 'failed';

    try {
      const result = await this.membership.subscribe({
        userId: order.userId,
        planId: order.membershipPlanId,
        orderId,
      });
      return result.alreadyApplied ? 'already' : 'applied';
    } catch (e: any) {
      // 闸门在 subscribe 的事务内, 失败时随事务一起回滚, 无需手工开回
      this.logger.error(`会员激活失败, 待重试 (订单 ${orderId}): ${e?.message ?? e}`);
      return 'failed';
    }
  }

  /**
   * 重试「已支付但会员未激活」的订单 (调度任务 task-recover 调用)。
   *
   * 只扫最近 7 天: 更早的失败单需要人工介入 —— 无限重试一个永久失败的订单
   * 只会把日志刷满, 且用户早已发现权益没到账。
   */
  async retryPendingMembershipActivation(limit = 50): Promise<number> {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const pending = await this.prisma.order.findMany({
      where: {
        status: 'paid',
        membershipPlanId: { not: null },
        membershipAppliedAt: null,
        paidAt: { gte: since },
      },
      select: { id: true },
      take: limit,
    });

    let applied = 0;
    for (const o of pending) {
      if ((await this.activateMembership(o.id)) === 'applied') applied += 1;
    }
    if (applied > 0) this.logger.log(`会员激活重试: 补发 ${applied} 单`);
    return applied;
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
    /** 退款规则（后台设置）。不传 = 不做额外限制，仅供内部脚本/历史调用 */
    rules?: RefundRules;
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

    /*
     * 先做「超出实付」的硬校验, 再走后台可配规则。
     *
     * 顺序不能反: 比例上限默认 100%, 此时「退得比实付还多」会先撞上比例规则,
     * 变成 409 + 「超出规则上限」—— 这是一条**参数错**却被告知是**规则拦的**,
     * 运营会去后台调比例上限而不是改金额。硬约束(400)优先于业务规则(409)。
     */
    const refundable = paidBase - order.refundedCents;
    if (params.amountCents > refundable) {
      throw new AppError(40001, `退款金额超出可退: 最多 ${refundable} 分`, 400);
    }

    // ── 退款规则 (B8, 后台可配) ────────────────────────────────────
    if (params.rules) {
      const { windowDays, maxRatioBps, allowConsumedTask } = params.rules;

      /*
       * 时间窗从 `paidAt` 起算。缺 paidAt 的历史订单**放行**:
       * 它们是本规则上线前产生的, 按规则拒绝会让运营无路可走。
       * 0 天 = 不限时间。
       */
      if (windowDays > 0 && order.paidAt) {
        const deadline = order.paidAt.getTime() + windowDays * 24 * 3600 * 1000;
        if (Date.now() > deadline) {
          throw new AppError(
            40905,
            `已超出可退款时间窗（支付后 ${windowDays} 天内），如需特殊处理请走人工审批`,
            409,
          );
        }
      }

      /*
       * 比例上限按**实付**向下取整, 再减去已退。
       * 取整方向决定资损方向: 向下取整最多少退 1 分, 向上会多退 1 分。
       */
      const ratioCap = Math.floor((paidBase * maxRatioBps) / 10000) - order.refundedCents;
      if (params.amountCents > ratioCap) {
        throw new AppError(
          40906,
          `退款金额超出规则上限: 本单最多可退 ${Math.max(ratioCap, 0)} 分（实付的 ${(
            maxRatioBps / 100
          ).toFixed(2)}% - 已退）`,
          409,
        );
      }

      if (!allowConsumedTask) {
        const consumed = await this.countUnreclaimableCredits(order.userId, order.grantedCredits);
        if (consumed > 0) {
          throw new AppError(
            40907,
            `该订单发放的积分已消耗 ${consumed} 分且无法扣回，按当前退款规则不允许退款`,
            409,
          );
        }
      }
    }

    const payment = order.payments.find((p) => p.status === 'succeeded');
    if (!payment) throw new AppError(40901, '订单无成功支付记录, 无法退款', 409);

    /*
     * 上一笔退款还没有结论时不允许再发起（2026-10-22）。
     *
     * 退款从「改库」变成了「真打回渠道」, 并发或连点两次会真的退两笔钱。
     * 微信的异步单 (PROCESSING) 也会占住这条件 —— 那正是想要的效果:
     * 结果未知时继续叠加新退款, 只会让对账彻底对不上。
     */
    const inFlight = await this.prisma.refund.count({
      where: { orderId: order.id, status: 'processing' },
    });
    if (inFlight > 0) {
      throw new AppError(
        40908,
        '该订单有一笔退款仍在渠道处理中，请等渠道返回结果或到商户后台确认后再操作',
        409,
      );
    }

    /*
     * 先解析通道再落退款单: 凭据缺失时 `byChannel` 抛 50301, 此时库里
     * 还没有任何退款行, 运营看到的是一条干净的「通道未配置」而不是
     * 一条半截的 processing 记录。
     *
     * `manual` 是后台「标记已支付」写入的通道, 没有真实资金进出, 因此
     * 不调渠道 —— 但仍要回收积分、迁移订单状态。
     */
    const channel = (payment.channel || 'sandbox').trim();
    const manualMark = channel === 'manual';
    const provider = manualMark ? null : this.paymentFactory.byChannel(channel);

    // 首次退款才扣积分; 部分退款的二次调用不应重复扣
    const firstRefund = order.refundedCents === 0;

    /*
     * 退款单先落库, 用它当**渠道幂等键** (`outRefundNo`)。
     *
     * 顺序不可反: 先调渠道再落库的话, 「渠道已受理但本地写库失败」就丢失了
     * 退款单号, 重试只能换一个新号 —— 那就是第二笔退款。
     */
    const refund = await this.prisma.refund.create({
      data: {
        orderId: order.id,
        paymentId: payment.id,
        userId: order.userId,
        amountCents: params.amountCents,
        // 积分回收要等渠道确认够不够真退了, 先记 0
        creditsReclaimed: 0,
        creditsUnreclaimable: 0,
        reason,
        operatorId: params.operatorId,
        status: 'processing',
        detail: '{}',
      },
    });

    let channelResult: PaymentRefundResult = {
      state: 'succeeded',
      raw: '手工标记已支付的订单，无渠道资金往来',
    };
    if (provider) {
      try {
        channelResult = await provider.refund({
          orderNo: order.orderNo,
          outRefundNo: refund.id,
          amountCents: params.amountCents,
          // 微信 v3 要求同时给「原订单总额」; 历史订单 amountCents 为 0 时回落实付
          totalCents: payment.amountCents > 0 ? payment.amountCents : paidBase,
          reason,
        });
      } catch (e) {
        // provider 契约是不抛异常; 真抛了按「结果未知」处理, 绝不能当成功
        channelResult = { state: 'failed', error: `渠道退款调用异常: ${(e as Error).message || e}` };
      }
    }

    if (channelResult.state === 'failed') {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: 'failed',
          providerRefundId: channelResult.providerRefundId ?? null,
          detail: JSON.stringify({ error: channelResult.error ?? null, raw: channelResult.raw ?? null }),
        },
      });
      this.logger.error(
        `渠道退款未完成: order=${order.id} refund=${refund.id} channel=${channel} — ${channelResult.error}`,
      );
      /*
       * 50302 + HTTP 502: 钱没退成, 但这不是「参数错」也不是「规则拦」。
       * 文案必须点明「订单状态与积分未变更」—— 否则运营会怀疑积分已经被扣回。
       */
      throw new AppError(
        50302,
        `渠道退款未完成：${channelResult.error || '未知原因'}（订单状态与积分未变更，可用同一退款单重试）`,
        502,
      );
    }

    if (channelResult.state === 'processing') {
      /*
       * 微信可能返回 PROCESSING(异步退款)。此时**不能**回收积分、不能改订单状态:
       * 渠道可能最终失败, 而我们无法自动得知 (本仓库没有退款回调端点)。
       * 退款行保持 processing, 由运营到商户后台确认后人工处理。
       */
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: 'processing',
          providerRefundId: channelResult.providerRefundId ?? null,
          detail: JSON.stringify({ note: '渠道异步处理中，需到商户后台确认', raw: channelResult.raw ?? null }),
        },
      });
      this.logger.warn(
        `渠道退款异步处理中: order=${order.id} refund=${refund.id} channel=${channel} providerRefundId=${channelResult.providerRefundId ?? '-'}`,
      );
      return {
        refundId: refund.id,
        state: 'processing' as const,
        pending: true,
        refundedCents: order.refundedCents,
        fullyRefunded: false,
        membershipTerminated: false,
        creditsReclaimed: 0,
        creditsUnreclaimable: 0,
        detail: [] as Array<{ lotId: string; taken: number }>,
        message:
          '渠道已受理退款但仍在异步处理中：订单状态与积分暂未变更，请到渠道商户后台确认最终结果',
      };
    }

    // ── 渠道确认退款成功, 才开始动本地账与积分 ────────────────────
    let reclaimed = { reclaimed: 0, unreclaimable: 0, detail: [] as Array<{ lotId: string; taken: number }> };
    if (firstRefund) {
      reclaimed = await this.credit.reclaimForOrder(params.orderId, params.operatorId, reason);
    }

    const refundedCents = order.refundedCents + params.amountCents;
    // 全额判定同样以实付为基准: 否则用券订单永远退不满, 会卡在 partial_refunded
    const fullyRefunded = refundedCents >= paidBase;

    await this.prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: 'succeeded',
        providerRefundId: channelResult.providerRefundId ?? null,
        creditsReclaimed: reclaimed.reclaimed,
        creditsUnreclaimable: reclaimed.unreclaimable,
        detail: JSON.stringify(reclaimed.detail),
      },
    });

    await this.transition(order.id, fullyRefunded ? 'refunded' : 'partial_refunded');
    await this.prisma.order.update({
      where: { id: order.id },
      data: { refundedCents },
    });

    /*
     * 会员订单全额退款 → 终止该订单发放的会员权益 (B8)。
     *
     * 只认 `Membership.orderId === 本单`: 续费复用同一条 Membership 行时,
     * orderId 指向最新一单, 旧单退款不该把用户正在使用的会员一起停掉。
     * 部分退款不动权益 —— 钱没退完就停权益等于既收钱又不给服务。
     */
    let membershipTerminated = false;
    if (fullyRefunded && order.membershipPlanId) {
      const ended = await this.prisma.membership.updateMany({
        where: { orderId: order.id, status: { in: ['active', 'grace'] } },
        data: { status: 'cancelled', nextCreditAt: null },
      });
      membershipTerminated = ended.count > 0;
      if (membershipTerminated) {
        this.logger.log(`会员订单全额退款, 已终止会员: order=${order.id}`);
      }
    }

    return {
      refundId: refund.id,
      state: 'succeeded' as const,
      pending: false,
      refundedCents,
      fullyRefunded,
      membershipTerminated,
      creditsReclaimed: reclaimed.reclaimed,
      creditsUnreclaimable: reclaimed.unreclaimable,
      detail: reclaimed.detail,
    };
  }

  /**
   * 该订单发放的积分里, 有多少已经花掉且扣不回来。
   *
   * 只算**未过期批次**的剩余量 —— 已过期的积分本来就作废了, 把它算成
   * 「可扣回」会让规则误放行; 算成「已消耗」又会拒绝本可退的订单。
   * 与 `CreditService.reclaimForOrder` 的取数口径保持一致。
   */
  private async countUnreclaimableCredits(userId: string, grantedCredits: number): Promise<number> {
    if (grantedCredits <= 0) return 0;
    const now = new Date();
    const agg = await this.prisma.creditLot.aggregate({
      where: {
        userId,
        remainingCredits: { gt: 0 },
        OR: [{ expireAt: null }, { expireAt: { gt: now } }],
      },
      _sum: { remainingCredits: true },
    });
    const available = agg._sum.remainingCredits ?? 0;
    return Math.max(0, grantedCredits - available);
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
      // 会员单要能显示"买的哪个套餐"(商品单该字段为空)
      membershipPlan: {
        select: { id: true, code: true, name: true, durationDays: true, monthlyCredits: true },
      },
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
      // 会员订阅单: membershipPlanId 非空即表示"本单买的是会员"
      membershipPlanId: o.membershipPlanId ?? null,
      membershipPlanCode: o.membershipPlan?.code ?? null,
      membershipPlanName: o.membershipPlan?.name ?? null,
      /** 会员权益是否已发放。paid 且为 null = 待重试 (正常几秒内完成) */
      membershipAppliedAt: o.membershipAppliedAt ?? null,
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