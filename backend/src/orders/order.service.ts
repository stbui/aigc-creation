import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { CreditService } from '../credits/credit.service';
import { formatCredits } from '../model/infra/microcredits';
import { MembershipService, parsePerks } from '../membership/membership.service';
import { MarketingService } from '../marketing/marketing.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../common/settings.service';
import { PaymentGateway } from '../payments/payment-gateway';
import { PaymentExceptionService } from '../payments/payment-exception.service';
import { lockUserRow } from '../account/user-row-lock';
import type { RefundResult } from '../payments/adapters/types';
import type { Prisma, Refund } from '@prisma/client';

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
 * OrdersModule 不依赖 admin 层, 规则键名只在一处（`common/setting-defs.ts`）定义。
 */
export interface RefundRules {
  /** 支付后多少天内可退, 0 = 不限 */
  windowDays: number;
  /** 可退金额上限占实付的万分比, 10000 = 全额 */
  maxRatioBps: number;
  /** 是否允许积分已被消耗的订单退款 */
  allowConsumedTask: boolean;
}

interface RefundSettlementResult {
  refundId: string;
  state: 'succeeded';
  pending: false;
  refundedCents: number;
  fullyRefunded: boolean;
  membershipTerminated: boolean;
  creditsReclaimed: number;
  creditsUnreclaimable: number;
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

/** 已支付事实（含退款）都占用每日充值额度。 */
const DAILY_LIMIT_PAID_STATUSES = ['paid', 'partial_refunded', 'refunded'];

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
     * 支付网关（2026-11 支付重构）。
     *
     * 退款必须真的打回渠道, 故订单域要能拿到通道实现。依赖的是
     * `PaymentCoreModule`（配置 + 适配器 + 网关, 只依赖 Prisma/Config）,
     * 不是 `PaymentsModule` —— 后者反过来 import 了本模块。
     */
    private readonly gateway: PaymentGateway,
    private readonly paymentExceptions: PaymentExceptionService,
    private readonly settings: SettingsService,
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

    const paymentRules = await this.settings.paymentRules();

    let totalCents = 0;
    let discountCents = 0;
    let paidCents = 0;
    let couponId: string | null = null;
    let campaignId: string | null = null;
    let couponSnapshot: Record<string, unknown> = {};
    let couponWarning: string | null = null;
    let membershipSnapshot: {
      perks: string;
      monthlyCredits: number;
      durationDays: number;
      userGroupCode: string;
    } | null = null;
    /** 订单币种。商品单取商品币种, 会员单固定 CNY; 混合币种直接 400 */
    let orderCurrency = 'CNY';
    /** 需要占用库存的商品项 (saleStrategy=inventory) */
    let stockItems: Array<{ productId: string; quantity: number }> = [];
    /** 周期限购商品需要在建单事务内重新统计，避免先查后插被并发绕过 */
    let periodicProducts: Array<{
      id: string;
      name: string;
      periodDays: number;
      periodPurchaseLimit: number;
    }> = [];
    /** 优惠结算使用的商品金额快照；事务内会据此重新校验券名额 */
    let settleItems: Array<{ productId: string; priceCents: number; quantity: number }> = [];
    let snapshots: Array<{
      productId: string;
      skuSnapshot: string;
      nameSnapshot: string;
      priceCentsSnapshot: number;
      creditsSnapshot: number;
      validDaysSnapshot: number;
      grantTypeSnapshot: string;
      stockReservedSnapshot: number;
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
      // 会员权益是下单时承诺给用户的内容，必须在创建订单时冻结快照。
      // 否则运营在待支付窗口内改价/改权益，会追溯影响已经创建的订单。
      membershipSnapshot = {
        perks: JSON.stringify(parsePerks(plan.perks)),
        monthlyCredits: plan.monthlyCredits,
        durationDays: plan.durationDays,
        userGroupCode: plan.userGroupCode ?? '',
      };
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
       * 币种与商品策略校验（支付重构）。
       *
       * 一个订单只能有一个币种：混合币种无法用单一渠道收款, 也无法对账。
       * 策略校验放在金额计算之前, 避免「价格算完了才发现库存不足」时,
       * 调用方仍看到部分成功的结果。
       */
      const currencies = new Set(products.map((p) => p.currency || 'CNY'));
      if (currencies.size > 1) {
        throw new AppError(40001, '同一订单内的商品币种必须一致', 400);
      }
      orderCurrency = [...currencies][0] ?? 'CNY';
      for (const item of items) {
        const p = byId.get(item.productId);
        if (!p) continue; // 下方会抛 404, 此处不重复
        if ((p.kind || 'credits') !== 'credits') {
          throw new AppError(40001, `商品类型暂不支持购买: ${p.name}`, 400);
        }
        this.assertProductPurchasable(p, item.quantity);
        if (p.saleStrategy === 'inventory') {
          stockItems.push({ productId: p.id, quantity: item.quantity });
        }
        if (
          p.saleStrategy === 'periodic' &&
          p.periodDays > 0 &&
          p.periodPurchaseLimit > 0
        ) {
          periodicProducts.push({
            id: p.id,
            name: p.name,
            periodDays: p.periodDays,
            periodPurchaseLimit: p.periodPurchaseLimit,
          });
        }
      }

      /*
       * 会员加油包折扣 (落地页承诺「加油包会员专享95 折」)。
       *
       * 折扣在**汇总商品金额后、快照之前**应用 —— 顺序错了会导致
       * 订单快照里记的是折前价, 退款时按折前价退, 平台自亏。
       * 同时订阅购买本身不走折扣(见 MembershipService.quoteOrder)。
       */
      settleItems = [];
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
          grantTypeSnapshot: p.grantType,
          stockReservedSnapshot: p.saleStrategy === 'inventory' ? item.quantity : 0,
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

    const expiresAt = new Date(
      Date.now() + paymentRules.orderTtlMinutes * 60 * 1000,
    );

    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        /*
         * 先锁用户行，再统计 pending 订单。
         *
         * 只在事务外 count 会被并发绕过：同一用户可以同时穿过检查，最终挂出
         * 超过设置上限的未支付订单并占住库存。SQLite 的 BEGIN 是 deferred，仅把
         * count 搬进事务仍不够，必须先做一次 no-op UPDATE 取得写锁，让同一
         * 用户的建单串行化。
         */
        await tx.$executeRaw`
          UPDATE "User" SET "name" = "name" WHERE id = ${params.userId}`;

        // 等待用户锁期间，另一个同幂等键请求可能已建单。此时必须返回既有单，
        // 不能先撞上限而把一个成功的重复请求误报成 400。
        const raced = await tx.order.findUnique({
          where: {
            userId_idempotencyKey: {
              userId: params.userId,
              idempotencyKey: params.idempotencyKey,
            },
          },
          include: this.orderInclude(),
        });
        if (raced) return { order: raced, idempotentHit: true };

        const activeOrders = await tx.order.count({
          where: { userId: params.userId, status: 'pending' },
        });
        if (activeOrders >= paymentRules.maxPendingOrders) {
          throw new AppError(
            40001,
            `最多同时保留 ${paymentRules.maxPendingOrders} 笔未支付订单，请先完成或取消已有订单`,
            400,
          );
        }

        /*
         * 券名额必须在建单事务内重新校验并预留。
         *
         * 事务外计算优惠时，多个请求可能同时看到最后一个名额。事务内结算会
         * 按用户输入的券码先锁 Coupon 行，再按「usedCount + pending 预占」和
         * 「每人 pending+已支付」复查；若名额已被抢走，则按活动/原价重新结算，
         * 不阻断用户下单。
         *
         * 即使首轮活动优惠大于券，也必须按券码加锁：两次结算之间活动可能失效，
         * 券会重新成为最终优惠，不锁行会让并发请求同时占用最后一个名额。
         *
         * 券锁必须早于商品锁，和支付事务保持相同加锁顺序，避免与支付转库存
         * 互相等待。
         */
        if (!isMembershipOrder) {
          const authoritativeDiscount = await this.marketing.settleDiscount({
            userId: params.userId,
            items: settleItems,
            couponCode: params.couponCode ?? null,
            campaignIds: params.campaignIds,
            tx,
            lockCouponForReservation: true,
          });
          discountCents = Math.min(authoritativeDiscount.discountCents, totalCents);
          paidCents = totalCents - discountCents;
          couponId = authoritativeDiscount.couponId;
          campaignId = authoritativeDiscount.campaignId;
          couponSnapshot = authoritativeDiscount.snapshot as Record<string, unknown>;
          couponWarning = (authoritativeDiscount.snapshot as any)?.couponWarning ?? null;
        }

        /*
         * 支付金额规则只约束真实收费订单。0 元单由免费领取链路处理，
         * 不应因为支付开关关闭或最低金额而失去领取入口。
         *
         * 这里位于用户锁与优惠权威重算之后：券/活动可能改变实付金额，
         * 事务外的首轮计算不能作为最终依据。
         */
        if (paidCents > 0) {
          if (!paymentRules.enabled) {
            throw new AppError(50301, '支付功能已关闭', 503);
          }
          if (paidCents < paymentRules.minAmountCents) {
            throw new AppError(
              40001,
              `单笔充值金额不得低于 ${formatYuan(paymentRules.minAmountCents)} 元`,
              400,
            );
          }
          if (
            paymentRules.maxAmountCents !== null &&
            paidCents > paymentRules.maxAmountCents
          ) {
            throw new AppError(
              40001,
              `单笔充值金额不得高于 ${formatYuan(paymentRules.maxAmountCents)} 元`,
              400,
            );
          }
          if (paymentRules.dailyLimitCents !== null) {
            const usedToday = await this.dailyRechargeCents(tx, params.userId);
            if (usedToday + paidCents > paymentRules.dailyLimitCents) {
              throw new AppError(
                40001,
                `超出今日充值限额：已占用 ${formatYuan(usedToday)} 元，本日上限 ${formatYuan(paymentRules.dailyLimitCents)} 元`,
                400,
              );
            }
          }
        }

        /*
         * 周期限购必须在建单事务内统计。
         *
         * SQLite 的 BEGIN 是 deferred：若只把 count 放进事务，两个进程仍可能
         * 同时读到旧值。先执行一次 no-op UPDATE 取得商品行写锁，再统计并建单，
         * 后到的事务会等前一笔提交后重新读到最新订单数。
         *
         * 计数口径保持「非 cancelled 订单数」，退款不返还周期额度。
         */
        for (const product of periodicProducts) {
          await tx.$executeRaw`
            UPDATE "Product" SET "sortOrder" = "sortOrder" WHERE id = ${product.id}`;
          await this.assertPeriodicPurchaseLimit(tx, product, params.userId);
        }

        const created = await tx.order.create({
          data: {
            orderNo: this.genOrderNo(),
            userId: params.userId,
            idempotencyKey: params.idempotencyKey,
            totalCents,
            discountCents,
            paidCents,
            currency: orderCurrency,
            couponId,
            campaignId,
            couponSnapshot: JSON.stringify(couponSnapshot),
            grantedCredits: 0, // 支付成功后才确定
            expiresAt,
            // 会员单不带 OrderItem: 它买的不是"多少积分", 而是一段权益周期
            membershipPlanId: isMembershipOrder ? params.membershipPlanId! : null,
            ...(membershipSnapshot
              ? {
                  membershipPerksSnapshot: membershipSnapshot.perks,
                  membershipMonthlyCreditsSnapshot: membershipSnapshot.monthlyCredits,
                  membershipDurationDaysSnapshot: membershipSnapshot.durationDays,
                  membershipUserGroupCodeSnapshot: membershipSnapshot.userGroupCode,
                }
              : {}),
            ...(snapshots.length > 0 ? { items: { create: snapshots } } : {}),
          },
          include: this.orderInclude(),
        });

        /*
         * 库存占用与订单创建同一事务 + 条件 SQL 防并发超卖。
         * Prisma 的 where 无法表达 `stockTotal - stockSold - stockReserved >= ?`,
         * 故用一条条件 UPDATE 让数据库裁决; 影响 0 行即库存不足, 整笔回滚。
         */
        if (stockItems.length > 0) {
          for (const item of stockItems) {
            const affected = await tx.$executeRaw`
              UPDATE "Product"
              SET "stockReserved" = "stockReserved" + ${item.quantity}
              WHERE id = ${item.productId}
                AND status = 'active'
                AND "stockTotal" - "stockSold" - "stockReserved" >= ${item.quantity}`;
            if (affected === 0) {
              throw new AppError(40001, '库存不足', 400);
            }
          }
          await tx.order.update({ where: { id: created.id }, data: { stockReserved: true } });
        }
        return { order: created, idempotentHit: false };
      });

      if (outcome.idempotentHit) {
        return { ...this.toOrderView(outcome.order), idempotentHit: true };
      }
      return {
        ...this.toOrderView(outcome.order),
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

  /**
   * C 端订单列表（服务端分页）。
   *
   * 之前固定 take:20 且不返回 total，超过 20 条的历史订单在 C 端永久不可见；
   * 筛选计数也只能对截断后的数组做统计。现在返回分页信息与各状态真实计数，
   * 前端可以「加载更多」并显示准确的筛选数量。
   */
  async listByUser(userId: string, limit = 20, offset = 0) {
    const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = Math.max(Number(offset) || 0, 0);
    const [orders, total, statusGroups] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: this.orderInclude(),
      }),
      this.prisma.order.count({ where: { userId } }),
      this.prisma.order.groupBy({
        by: ['status'],
        where: { userId },
        _count: { _all: true },
      }),
    ]);
    const statusCounts = Object.fromEntries(
      statusGroups.map((row) => [row.status, row._count._all]),
    );
    return {
      items: orders.map((o) => this.toOrderView(o)),
      total,
      limit: take,
      offset: skip,
      statusCounts,
    };
  }

  /*
   * 用户取消订单不在本 service 提供入口：必须走 PaymentOrderService.close()，
   * 先向渠道查单/关单，再在本地置 cancelled 并释放库存与券预占。
   * 这里保留说明而不保留直改状态的便捷方法，避免未来误用绕过资金安全链路。
   */

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
    if (process.env.NODE_ENV === 'production') {
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

    /*
     * 站内模拟支付只能用于沙箱订单。
     * 仅挡 production 不够：测试/预发环境若配了真实渠道，用户对一笔
     * 支付宝/微信订单调用本端点仍可免费入账。渠道不是 sandbox 一律拒绝。
     */
    if (order.channel !== 'sandbox') {
      throw new AppError(40901, '该订单不是沙箱订单，不能使用站内模拟支付', 409);
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
      await this.cancelSandboxOrder(order.id);
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
      const outcome = await this.cancelSandboxOrder(order.id);
      if (outcome === 'paid') {
        const paid = await this.detail(order.id);
        return { order: paid, idempotentHit: true, message: '订单已支付' };
      }
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
    /** 渠道币种; 传入时必须与订单币种一致 */
    currency?: string;
    providerConfigId?: string | null;
    providerConfigVersion?: number | null;
    /** 本次实际入账的支付实例；老订单/老调用方可为空 */
    providerInstanceId?: string | null;
    providerStatus?: string | null;
    providerPaidAt?: Date;
    /** intent 阶段已创建的 pending Payment; 有则原地更新, 不再新建 */
    paymentId?: string;
    /** 渠道实收金额; 传入时必须与订单应付一致 */
    amountCents?: number;
    sandboxScenario?: string;
    /** 渠道原始回调报文 (真实通道; 沙箱为空)。只落库, 不进接口响应 */
    rawPayload?: string;
    /** 渠道侧下单单据 id（PayPal order id / Stripe Checkout Session id 等） */
    providerRef?: string | null;
  }) {
    // 1) 交易号已存在 = 重复回调
    const dupPayment = await this.prisma.payment.findUnique({
      where: { payTransactionId: params.payTransactionId },
    });
    if (dupPayment) {
      /*
       * 交易号唯一是全局的。若它已绑定到另一笔订单，说明渠道侧数据串单，
       * 不能按本单幂等成功返回 —— 否则本单会一直 pending，而通知被 ack 成功。
       */
      if (dupPayment.orderId !== params.orderId) {
        throw new AppError(40901, '渠道交易号已绑定其他订单', 409);
      }
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

    /*
     * 金额与币种校验必须在这里, 不能只依赖调用方。
     * `markPaid` 是唯一入账入口, 任何新增调用方 (回调/查单/对账/后台补发)
     * 漏校验都会变成资损: 少收钱记成全额, 或把 USD 单按 CNY 入账。
     */
    if (params.currency && params.currency !== (order.currency || 'CNY')) {
      throw new AppError(
        40901,
        `币种不一致: 渠道 ${params.currency} / 订单 ${order.currency || 'CNY'}`,
        409,
      );
    }
    if (params.amountCents !== undefined && params.amountCents !== order.paidCents) {
      throw new AppError(
        40901,
        `金额不一致: 渠道 ${params.amountCents} 分 / 订单 ${order.paidCents} 分`,
        409,
      );
    }

    const succeededFields = {
      // 流水金额记**实付**, 不是订单原价。记原价会让对账看起来"收了全价",
      // 而用户实际少付了优惠部分 —— 财务对账时这个差额无法解释
      payTransactionId: params.payTransactionId,
      channel: params.channel,
      amountCents: order.paidCents,
      status: 'succeeded',
      paidAt: new Date(),
      currency: order.currency || 'CNY',
      providerConfigId: params.providerConfigId ?? order.providerConfigId ?? null,
      providerConfigVersion: params.providerConfigVersion ?? order.providerConfigVersion ?? null,
      providerInstanceId:
        params.providerInstanceId ?? order.providerInstanceId ?? null,
      providerStatus: params.providerStatus ?? null,
      lastError: null,
      closedAt: null,
      sandboxScenario: params.sandboxScenario ?? null,
      rawPayload: params.rawPayload ?? '',
      ...(params.providerRef ? { providerRef: params.providerRef } : {}),
    };

    try {
      const won = await this.prisma.$transaction(async (tx) => {
        // 与邀请绑定共用同一把用户行锁：绑定若先提交，本笔支付就属于绑定后的
        // 首次付费；支付若先提交，绑定侧会看到 paid 并拒绝补绑。
        await lockUserRow(tx, order.userId);

        /*
         * 支付入账必须与建单预留使用同一把券锁，并在改订单状态前取得。
         * 否则建单可能在「订单仍 pending、usedCount 尚未增加」的窗口里再次
         * 放出同一张限量券。
         */
        if (order.couponId) {
          await this.marketing.lockCoupon(order.couponId, tx);
        }

        /*
         * `grantedCredits` 必须等于**实际自动发放的积分**。
         *
         * manual 商品由后台手工发放，不走自动发放；若这里仍按全部 OrderItem
         * 累加，退款回收 (`reclaimForOrder`) 会以这个虚高快照为上限，从用户
         * 其它批次里扣走从未到账的积分。先决定哪些条目会发，再累加。
         *
         * 会员积分也不能在这里预记：提前续费的新周期可能尚未开始，首月积分
         * 要等周期开始后才发放。会员每次实际发分时会在同一事务累加本字段。
         */
        const autoGrantItems: typeof order.items = [];
        let grantedCredits = 0;
        for (const item of order.items) {
          // 新订单按下单时快照发放。历史订单没有快照时才回退当前商品配置，
          // 确保加列前的待支付订单仍保持旧行为，不会因字段为空全部停发。
          const grantType =
            item.grantTypeSnapshot ??
            (item.productId
              ? (await tx.product.findUnique({ where: { id: item.productId } }))?.grantType
              : null);
          if (grantType === 'manual') continue;
          autoGrantItems.push(item);
          grantedCredits += item.creditsSnapshot * item.quantity;
        }

        /*
         * 先抢占订单状态（条件更新）。
         *
         * 查重与状态判断都在事务外，两个不同交易号的并发回调可能都读到
         * pending。这里用 `status='pending'` 条件更新让数据库裁决唯一赢家；
         * 输家不再写 Payment、不再发积分，只按「已支付」幂等返回。
         * 用无条件 update 会让两笔都发积分，退款时也只按一个 grantedCredits 回收。
         */
        const claimed = await tx.order.updateMany({
          where: { id: order.id, status: 'pending' },
          data: {
            status: 'paid',
            // 订单渠道以**实际成功入账**的渠道为准；发起支付时的 channel 只是最后一次尝试。
            // 0 元单记 'free'，后台渠道列显示「免费」且不参与渠道筛选。
            channel: params.channel,
            paidAt: new Date(),
            grantedCredits,
            providerTradeNo: params.payTransactionId,
            providerStatus: params.providerStatus ?? null,
            providerConfigId: params.providerConfigId ?? order.providerConfigId ?? null,
            providerConfigVersion:
              params.providerConfigVersion ?? order.providerConfigVersion ?? null,
            providerInstanceId:
              params.providerInstanceId ?? order.providerInstanceId ?? null,
            providerPaidAt: params.providerPaidAt ?? new Date(),
            // 终态必须清空 checkoutValue, 否则页面会把过期链接当可用
            checkoutValue: '',
            lastError: null,
            closeStartedAt: null,
            intentStartedAt: null,
            stockReserved: false,
          },
        });
        if (claimed.count === 0) return false;

        // 订单已在本事务内置为 paid，此时核销才具备原子性且不会被重复计数。
        if (order.couponId) {
          await this.marketing.redeemCoupon(order.couponId, order.id, tx);
        }

        /*
         * 有 pending 尝试就原地更新 (保留本次支付尝试的创建时间与 id),
         * 否则新建。更新 0 行说明该尝试已被关单/并发入账, 回退为 create。
         */
        let updatedExisting = 0;
        if (params.paymentId) {
          const result = await tx.payment.updateMany({
            where: { id: params.paymentId, orderId: order.id, status: 'pending' },
            data: succeededFields,
          });
          updatedExisting = result.count;
        }
        if (!params.paymentId || updatedExisting === 0) {
          await tx.payment.create({
            data: { orderId: order.id, userId: params.userId, ...succeededFields },
          });
        }

        /*
         * 库存占用转已售: 与订单置 paid 同一事务, 否则「已支付但库存仍占用」
         * 会让该商品永久少卖一份。
         */
        if (order.stockReserved) {
          for (const item of order.items) {
            if (!item.productId) continue;
            let reservedQuantity = item.stockReservedSnapshot;
            if (reservedQuantity == null) {
              // 历史订单没有库存快照，只能按当前策略兜底；新订单一律走快照。
              const product = await tx.product.findUnique({
                where: { id: item.productId },
                select: { saleStrategy: true },
              });
              reservedQuantity = product?.saleStrategy === 'inventory' ? item.quantity : 0;
            }
            if (reservedQuantity <= 0) continue;
            await tx.product.update({
              where: { id: item.productId },
              data: {
                stockSold: { increment: reservedQuantity },
                stockReserved: { decrement: reservedQuantity },
              },
            });
          }
        }

        for (const item of autoGrantItems) {
          /*
           * 0 积分商品（免费发放 / 纯权益商品）没有可发的批次。
           * `CreditService.grant` 对 ≤ 0 明确抛错，若不跳过，整笔支付事务会
           * 回滚——订单永远停在 pending，渠道重试也无法入账。
           */
          const credits = item.creditsSnapshot * item.quantity;
          if (credits <= 0) continue;
          await this.credit.grant({
            userId: params.userId,
            credits,
            source: 'purchase',
            validDays: item.validDaysSnapshot,
            orderId: order.id,
          }, tx);
        }

        return true;
      });

      if (!won) {
        const current = await this.detail(params.orderId);
        if (current.status === 'paid') {
          return { order: current, idempotentHit: true, message: '订单已支付' };
        }
        throw new AppError(40901, `订单当前状态不可支付: ${current.status}`, 409);
      }
    } catch (e) {
      /*
       * 并发重复回调可能同时通过前面的交易号查重, 最终由 Payment.payTransactionId
       * 唯一约束裁决。P2002 说明另一条通知已经入账成功, 这里按幂等成功返回,
       * 绝不能把重复通知抛成 500 —— 那会让渠道持续重试到死信。
       */
      if ((e as { code?: string })?.code === 'P2002') {
        const current = await this.detail(params.orderId);
        // 只有本单确实已支付才算幂等成功；否则是交易号撞到了别的订单/别的约束，
        // 必须抛出去让通知落差异，不能 ack 成功把本单留在 pending。
        if (current.status === 'paid') {
          return { order: current, idempotentHit: true, message: '重复回调, 已忽略' };
        }
        throw new AppError(40901, '渠道交易号冲突，订单未入账', 409);
      }
      throw e;
    }

    /*
     * 营销副作用放在事务**之外**。
     *
     * 理由: 券核销与邀请发奖都是独立的资源变更, 若放进同一事务, 失败会连带
     * 回滚"支付成功"这一既成事实 —— 钱收了但订单回到 pending, 是更糟的状态。
     * 两者自身都有幂等闸 (条件更新), 重复执行安全。
     */
    try {
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
        // 支付成功后、权益激活前可能先发生部分退款；只要不是全额退款，
        // 订单对应的会员周期仍然有效，恢复任务必须继续补激活。
        status: { in: ['paid', 'partial_refunded'] },
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
    // 事务外先做一次快速失败；真正生效的校验会在订单行锁内用最新数据重跑。
    await this.assertRefundPolicy({
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
            },
          },
        },
      });
      if (!fresh || (fresh.status !== 'paid' && fresh.status !== 'partial_refunded')) {
        throw new AppError(40901, `订单当前状态不可退款: ${fresh?.status ?? 'missing'}`, 409);
      }

      const policy = await this.assertRefundPolicy({
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

      const latestFailed = await tx.refund.findFirst({
        where: {
          orderId: order.id,
          paymentId: payment.id,
          status: 'failed',
          amountCents: params.amountCents,
        },
        orderBy: { createdAt: 'desc' },
      });
      const reusable =
        latestFailed &&
        parseJsonObject(latestFailed.detail).confirmationOutcome !== 'failed'
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
    // `manual` 是后台「标记已支付」写入的通道, 没有真实资金进出, 不调渠道
    const channel = (payment.channel || 'sandbox').trim();
    const manualMark = channel === 'manual';
    let channelResult: RefundResult = {
      state: 'succeeded',
      raw: '手工标记已支付的订单，无渠道资金往来',
    };
    if (!manualMark) {
      channelResult = await this.gateway.refund({
        // 必须用**实际成功支付**的渠道与配置版本，不能用 Order.channel：
        // 订单上记的是最后一次发起支付的渠道，跨渠道重试后两者可能不同。
        order: {
          channel: payment.channel,
          providerConfigId: payment.providerConfigId ?? order.providerConfigId,
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
    }

    if (channelResult.state === 'failed') {
      const marked = await this.prisma.refund.updateMany({
        where: { id: refund.id, status: 'processing' },
        data: {
          status: 'failed',
          providerRefundId: channelResult.providerRefundId ?? null,
          detail: JSON.stringify({ error: channelResult.error ?? null, raw: channelResult.raw ?? null }),
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
      const marked = await this.prisma.refund.updateMany({
        where: { id: refund.id, status: 'processing' },
        data: {
          status: 'processing',
          providerRefundId: channelResult.providerRefundId ?? null,
          detail: JSON.stringify({ note: '渠道异步处理中，需到商户后台确认', raw: channelResult.raw ?? null }),
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
        throw new AppError(40909, `退款单当前状态不可人工核销: ${refund.status}`, 409);
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
        throw new AppError(40909, `退款单当前状态不可核销: ${refund.status}`, 409);
      }

      const order = refund.order;
      if (order.status !== 'paid' && order.status !== 'partial_refunded') {
        throw new AppError(40901, `订单当前状态不可退款: ${order.status}`, 409);
      }
      /*
       * 会员订单必须先锁用户，再写退款/订单状态。订阅激活也是 User → Order，
       * 若这里反过来先写订单再等用户，会出现「退款持有订单等用户、激活持有用户
       * 等订单」的死锁。锁用户后，会员周期撤销与并发续费也共享同一串行化点。
       */
      if (order.membershipPlanId) {
        await this.membership.lockMembershipProjectionInTransaction(
          tx,
          refund.userId,
        );
      }
      const paidBase = order.paidCents > 0
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
        String(params.providerRefundId ?? '').trim() ||
        refund.providerRefundId ||
        null;
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
        _sum: { creditsReclaimed: true, creditsUnreclaimable: true },
      });
      const accountedCredits =
        (previousCredits._sum.creditsReclaimed ?? 0) +
        (previousCredits._sum.creditsUnreclaimable ?? 0);
      const cumulativeCreditTarget = paidBase > 0
        ? Number(
            (BigInt(order.grantedCredits) * BigInt(refundedCents)) /
              BigInt(paidBase),
          )
        : 0;
      const creditsToReclaim = Math.max(0, cumulativeCreditTarget - accountedCredits);
      const credits = creditsToReclaim > 0
        ? await this.credit.reclaimForOrderInTransaction(
            tx,
            order.id,
            params.operatorId,
            params.reason,
            creditsToReclaim,
          )
        : { reclaimed: 0, unreclaimable: 0, detail: [] };
      const fullyRefunded = refundedCents >= paidBase;
      const bumped = await tx.order.updateMany({
        where: { id: order.id, refundedCents: order.refundedCents },
        data: { refundedCents },
      });
      if (bumped.count === 0) {
        throw new AppError(40909, '订单已退金额已变化，请刷新后重试', 409);
      }
      await this.transition(
        order.id,
        fullyRefunded ? 'refunded' : 'partial_refunded',
        tx,
      );

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

  /**
   * 本次退款目标份额里, 有多少已经花掉且扣不回来。
   *
   * 过期积分虽然不可扣回，但它不是「已消费」：把过期未用部分算成消费会
   * 错误拒绝退款；完全不算又可能把已经花掉的积分误放行。因此可用证据 =
   * 未过期批次剩余 + 已过期但未使用部分（过期批次仍有余量或 expire 流水）。
   * 只有超出这部分的目标份额，才属于本次退款无法追回的真实消费。
   */
  private async countUnreclaimableCredits(
    orderId: string,
    creditsToReclaim: number,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<number> {
    if (creditsToReclaim <= 0) return 0;
    const now = new Date();
    const lots = await db.creditLot.findMany({
      where: { orderId },
      select: { id: true, remainingMicrocredits: true, expireAt: true },
    });

    let activeMicrocredits = 0n;
    let expiredRemainingMicrocredits = 0n;
    for (const lot of lots) {
      if (lot.expireAt && lot.expireAt.getTime() <= now.getTime()) {
        expiredRemainingMicrocredits += lot.remainingMicrocredits;
      } else {
        activeMicrocredits += lot.remainingMicrocredits;
      }
    }

    // 到期任务会把批次剩余清零，只留下负向 expire 流水；两者取和可覆盖
    // 「尚未执行到期任务」和「已经执行」两种状态，且不会重复计算。
    const expiredLedger = lots.length
      ? await db.creditLedgerEntry.aggregate({
          where: {
            type: 'expire',
            lotId: { in: lots.map((lot) => lot.id) },
          },
          _sum: { amountMicrocredits: true },
        })
      : null;
    const expiredLedgerMicrocredits = expiredLedger?._sum.amountMicrocredits ?? 0n;
    const expiredUnusedMicrocredits =
      expiredRemainingMicrocredits +
      (expiredLedgerMicrocredits < 0n ? -expiredLedgerMicrocredits : expiredLedgerMicrocredits);

    // 批次是微积分口径，规则入参是积分口径，换算只在这一处发生
    const available = Number(formatCredits(activeMicrocredits + expiredUnusedMicrocredits));
    return Math.max(0, creditsToReclaim - available);
  }

  /**
   * 退款金额与后台规则校验。
   *
   * 调用方必须在订单行锁内再调用一次，不能复用事务外的判断结果。
   */
  private async assertRefundPolicy(params: {
    db: Prisma.TransactionClient | PrismaService;
    order: {
      id: string;
      paidCents: number;
      totalCents: number;
      refundedCents: number;
      grantedCredits: number;
      paidAt: Date | null;
      payments: Array<{ status: string; channel: string }>;
      refunds: Array<{
        status: string;
        creditsReclaimed: number;
        creditsUnreclaimable: number;
      }>;
    };
    amountCents: number;
    rules?: RefundRules;
  }): Promise<{ paidBase: number; refundable: number }> {
    /*
     * 可退上限 = **实付** - 已退, 不是订单原价。
     *
     * ⚠ 用原价会导致直接资损: 100 元订单用了 30 元券, 实付 70 元, 却能退 100 元。
     * 兼容无优惠的历史订单: paidCents 为 0 且没有 free 成功流水时回落 totalCents
     * (旧数据未回填该字段)。0 元单有 channel='free' 的成功流水，上限必须是 0，
     * 否则会把「没付过钱」的订单当成可退原价。
     */
    const isFreeOrder = params.order.payments.some(
      (payment) => payment.status === 'succeeded' && payment.channel === 'free',
    );
    const paidBase = params.order.paidCents > 0
      ? params.order.paidCents
      : isFreeOrder
        ? 0
        : params.order.totalCents;
    const refundable = paidBase - params.order.refundedCents;

    /*
     * 先做「超出实付」的硬校验, 再走后台可配规则。
     *
     * 顺序不能反: 比例上限默认 100%, 此时「退得比实付还多」会先撞上比例规则,
     * 变成 409 + 「超出规则上限」—— 这是一条**参数错**却被告知是**规则拦的**,
     * 运营会去后台调比例上限而不是改金额。硬约束(400)优先于业务规则(409)。
     */
    if (params.amountCents > refundable) {
      throw new AppError(40001, `退款金额超出可退: 最多 ${refundable} 分`, 400);
    }

    if (!params.rules) return { paidBase, refundable };

    const { windowDays, maxRatioBps, allowConsumedTask } = params.rules;

    /*
     * 时间窗从 `paidAt` 起算。缺 paidAt 的历史订单**放行**:
     * 它们是本规则上线前产生的, 按规则拒绝会让运营无路可走。
     * 0 天 = 不限时间。
     */
    if (windowDays > 0 && params.order.paidAt) {
      const deadline =
        params.order.paidAt.getTime() + windowDays * 24 * 3600 * 1000;
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
    const ratioCap =
      Math.floor((paidBase * maxRatioBps) / 10000) - params.order.refundedCents;
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
      /*
       * 规则看的是**本次退款应回收的份额**，不是整单发放量。部分退款只撤销
       * 对应比例的积分；只要本单尚未消耗的批次足够覆盖该份额，就不该因为
       * 其余积分已经使用而把整笔退款拒掉。
       */
      const previousAccountedCredits = params.order.refunds
        .filter((refund) => refund.status === 'succeeded')
        .reduce(
          (sum, refund) =>
            sum + refund.creditsReclaimed + refund.creditsUnreclaimable,
          0,
        );
      const cumulativeCreditTarget = paidBase > 0
        ? Number(
            (BigInt(params.order.grantedCredits) *
              BigInt(params.order.refundedCents + params.amountCents)) /
              BigInt(paidBase),
          )
        : 0;
      const creditsToReclaim = Math.max(
        0,
        cumulativeCreditTarget - previousAccountedCredits,
      );
      const consumed = await this.countUnreclaimableCredits(
        params.order.id,
        creditsToReclaim,
        params.db,
      );
      if (consumed > 0) {
        throw new AppError(
          40907,
          `本次退款应回收的积分中有 ${consumed} 分已消耗且无法从本单扣回，按当前退款规则不允许退款`,
          409,
        );
      }
    }

    return { paidBase, refundable };
  }

  // ── 状态机 ────────────────────────────────────────────────────────

  /**
   * 商品可购买性校验（支付重构）。
   *
   * 与后台「销售中」徽标同一套口径：限时窗口按 Asia/Shanghai 解释后台输入的时间，
   * 库存按「总量 - 已售 - 已占用」计算；周期限购在事务内单独统计。
   * 页面的「销售中」不等于可购买，最终以这里为准。
   */
  private assertProductPurchasable(
    product: {
      id: string;
      name: string;
      saleStrategy: string;
      stockTotal: number;
      stockSold: number;
      stockReserved: number;
      saleStartAt: Date | null;
      saleEndAt: Date | null;
    },
    quantity: number,
  ): void {
    const now = Date.now();

    if (product.saleStrategy === 'timed') {
      if (product.saleStartAt && now < product.saleStartAt.getTime()) {
        throw new AppError(40001, `商品尚未开售: ${product.name}`, 400);
      }
      if (product.saleEndAt && now > product.saleEndAt.getTime()) {
        throw new AppError(40001, `商品已结束销售: ${product.name}`, 400);
      }
    }

    if (product.saleStrategy === 'inventory') {
      const remaining = product.stockTotal - product.stockSold - product.stockReserved;
      if (remaining < quantity) {
        throw new AppError(40001, `库存不足: ${product.name}（剩余 ${Math.max(remaining, 0)}）`, 400);
      }
    }
  }

  /**
   * 周期限购统计。调用方必须先取得商品行写锁，保证 count 与 create 之间
   * 不会被另一笔建单插入。
   */
  /** 当日已占用充值额度：已支付事实 + 尚未过期的待支付预占。 */
  private async dailyRechargeCents(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<number> {
    const dayStart = startOfShanghaiDay(new Date());
    const now = new Date();
    const aggregate = await tx.order.aggregate({
      where: {
        userId,
        OR: [
          {
            status: { in: DAILY_LIMIT_PAID_STATUSES },
            paidAt: { gte: dayStart },
          },
          {
            status: 'pending',
            createdAt: { gte: dayStart },
            expiresAt: { gt: now },
          },
        ],
      },
      _sum: { paidCents: true },
    });
    return aggregate._sum.paidCents ?? 0;
  }

  private async assertPeriodicPurchaseLimit(
    tx: Pick<Prisma.TransactionClient, 'order'>,
    product: { id: string; name: string; periodDays: number; periodPurchaseLimit: number },
    userId: string,
  ): Promise<void> {
    const since = new Date(Date.now() - product.periodDays * 24 * 3600 * 1000);
    const used = await tx.order.count({
      where: {
        userId,
        status: { not: 'cancelled' },
        createdAt: { gte: since },
        items: { some: { productId: product.id } },
      },
    });
    if (used >= product.periodPurchaseLimit) {
      throw new AppError(
        40001,
        `该商品每 ${product.periodDays} 天最多购买 ${product.periodPurchaseLimit} 次，当前已达上限`,
        400,
      );
    }
  }

  /**
   * 释放库存占用（取消/超时/关单）。
   *
   * 幂等：先条件更新 `stockReserved: true → false` 抢占，抢不到直接返回，
   * 避免重复释放把 `stockReserved` 减成负数。
   */
  async releaseReservation(
    orderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const release = async (db: Prisma.TransactionClient | PrismaService) => {
      const order = await db.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          stockReserved: true,
          items: {
            select: {
              productId: true,
              quantity: true,
              stockReservedSnapshot: true,
            },
          },
        },
      });
      if (!order || !order.stockReserved) return;

      const flag = await db.order.updateMany({
        where: { id: orderId, stockReserved: true },
        data: { stockReserved: false },
      });
      if (flag.count === 0) return;
      for (const item of order.items) {
        if (!item.productId) continue;
        let reservedQuantity = item.stockReservedSnapshot;
        if (reservedQuantity == null) {
          // 历史订单没有库存快照，只能按当前策略兜底；新订单一律走快照。
          const product = await db.product.findUnique({
            where: { id: item.productId },
            select: { saleStrategy: true },
          });
          reservedQuantity = product?.saleStrategy === 'inventory' ? item.quantity : 0;
        }
        if (reservedQuantity <= 0) continue;
        await db.product.update({
          where: { id: item.productId },
          data: { stockReserved: { decrement: reservedQuantity } },
        });
      }
    };

    if (tx) {
      await release(tx);
      return;
    }
    await this.prisma.$transaction(release);
  }

  /**
   * 校验并执行状态迁移。非法迁移抛 409, 绝不静默通过。
   *
   * `tx` 用于「状态迁移必须与另一处写入同时生效」的场景（退款记账）：
   * 传了事务客户端就走同一个事务，否则各自独立提交。
   */
  async transition(
    orderId: string,
    to: OrderStatus,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    /*
     * 取消订单必须经过支付编排层的查单/关单链路。沙箱超时是唯一例外，
     * 由 `cancelSandboxOrder` 在本地原子收尾；这里继续放行会留下
     * “订单已取消但 pending Payment / 库存占用仍在”的脏状态。
     */
    if (to === 'cancelled') {
      throw new AppError(
        40901,
        '取消订单必须走支付关单流程，不能直接迁移状态',
        409,
      );
    }
    const db = tx ?? this.prisma;
    const order = await db.order.findUnique({
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
    await db.order.update({ where: { id: orderId }, data: { status: to } });
  }

  /**
   * 沙箱支付超时的本地原子取消。
   *
   * 沙箱没有外部渠道订单，但仍必须与支付编排保持相同终态：订单 cancelled、
   * pending 支付尝试 closed、库存占用释放，三者同一事务完成。调用前已校验
   * 订单属于当前用户且 channel=sandbox。
   */
  private async cancelSandboxOrder(
    orderId: string,
  ): Promise<'cancelled' | 'paid'> {
    return this.prisma.$transaction(async (tx) => {
      // SQLite deferred transaction 需要先写一行拿到订单级写锁，再判断状态。
      await tx.$executeRaw`
        UPDATE "Order" SET "updatedAt" = "updatedAt" WHERE id = ${orderId}`;
      const current = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      if (!current) throw new AppError(40400, '订单不存在', 404);
      if (current.status === 'paid') return 'paid';
      if (current.status !== 'pending') {
        throw new AppError(
          40901,
          `订单当前状态不可关闭: ${current.status}`,
          409,
        );
      }

      await tx.payment.updateMany({
        where: { orderId, status: 'pending' },
        data: { status: 'closed', closedAt: new Date() },
      });
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'cancelled',
          closedAt: new Date(),
          closeStartedAt: null,
          intentStartedAt: null,
          checkoutValue: '',
          lastError: null,
        },
      });
      await this.releaseReservation(orderId, tx);
      return 'cancelled';
    });
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
    /*
     * 会员加油包折扣。
     *
     * `totalCents` 存的是**会员折扣后**的小计，`discountCents` 只含券/活动；
     * 前端要逐行展示 "原价 - 会员优惠 - 券优惠 = 实付"，必须把这段差额
     * 单独透出。不能用 discountCents 反推，否则会员单的账永远算不平。
     * 会员订阅单没有 OrderItem（items 为空），差额为 0。
     */
    const itemsSubtotalCents = (o.items ?? []).reduce(
      (sum: number, item: any) => sum + item.priceCentsSnapshot * item.quantity,
      0,
    );
    const memberDiscountCents = Math.max(0, itemsSubtotalCents - (o.totalCents ?? 0));
    return {
      id: o.id,
      orderNo: o.orderNo,
      userId: o.userId,
      userEmail: o.user?.email ?? '',
      status: o.status,
      channel: o.channel,
      /** 商品原价小计（会员订阅单为套餐原价） */
      itemsSubtotalCents: itemsSubtotalCents || o.totalCents,
      totalCents: o.totalCents,
      memberDiscountCents,
      discountCents: o.discountCents ?? 0,
      /*
       * 旧订单无 paidCents 字段值时回落原价, 避免展示为 0 元。
       * 但真正的 0 元单有 channel='free' 的成功流水，必须显示 0，
       * 不能回落成原价 —— 否则用户会看到「免费领取的包要付全价」。
       */
      paidCents:
        o.paidCents > 0
          ? o.paidCents
          : (o.payments ?? []).some(
                (p: any) => p.status === 'succeeded' && p.channel === 'free',
              )
            ? 0
            : o.totalCents,
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
        status: r.status,
        providerRefundId: r.providerRefundId ?? null,
        detail: r.detail,
        operatorId: r.operatorId ?? null,
        createdAt: r.createdAt,
      })),
    };
  }
}

function startOfShanghaiDay(now: Date): Date {
  const offsetMs = 8 * 60 * 60 * 1000;
  const shifted = new Date(now.getTime() + offsetMs);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ) - offsetMs,
  );
}

function formatYuan(cents: number): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}
