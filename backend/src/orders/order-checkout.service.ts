import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppError } from '../common/app.exception';
import { SettingsService } from '../common/settings.service';
import { MarketingService } from '../marketing/marketing.service';
import { MembershipService, parsePerks } from '../membership/membership.service';
import { PrismaService } from '../prisma/prisma.service';
import { orderInclude, toOrderView } from './order.view';

/** 已支付事实（含退款）都占用每日充值额度。 */
const DAILY_LIMIT_PAID_STATUSES = ['paid', 'partial_refunded', 'refunded'];

/**
 * 下单。
 *
 * 会员单与商品单的金额、优惠、库存规则差异只在这里收口；支付、退款、
 * 状态机不感知下单细节。
 */
@Injectable()
export class OrderCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketing: MarketingService,
    private readonly membership: MembershipService,
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
      throw new AppError(40001, '请选择积分商品或会员套餐', 400);
    }

    // 幂等命中: 直接返回既有订单, 不重复创建
    const existing = await this.prisma.order.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: params.userId,
          idempotencyKey: params.idempotencyKey,
        },
      },
      include: orderInclude(),
    });
    if (existing) {
      return { ...toOrderView(existing), idempotentHit: true };
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
    const stockItems: Array<{ productId: string; quantity: number }> = [];
    /** 周期限购商品需要在建单事务内重新统计，避免先查后插被并发绕过 */
    const periodicProducts: Array<{
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
        if (p.saleStrategy === 'periodic' && p.periodDays > 0 && p.periodPurchaseLimit > 0) {
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

    const expiresAt = new Date(Date.now() + paymentRules.orderTtlMinutes * 60 * 1000);

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
          include: orderInclude(),
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
          if (paymentRules.maxAmountCents !== null && paidCents > paymentRules.maxAmountCents) {
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
          include: orderInclude(),
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
        return { ...toOrderView(outcome.order), idempotentHit: true };
      }
      return {
        ...toOrderView(outcome.order),
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
        include: orderInclude(),
      });
      if (dup) return { ...toOrderView(dup), idempotentHit: true };
      throw e;
    }
  }

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
        throw new AppError(
          40001,
          `库存不足: ${product.name}（剩余 ${Math.max(remaining, 0)}）`,
          400,
        );
      }
    }
  }

  /** 当日已占用充值额度：已支付事实 + 尚未过期的待支付预占。 */
  private async dailyRechargeCents(tx: Prisma.TransactionClient, userId: string): Promise<number> {
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

  /**
   * 周期限购统计。调用方必须先取得商品行写锁，保证 count 与 create 之间
   * 不会被另一笔建单插入。
   */
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
}

export type CreateOrderParams = Parameters<OrderCheckoutService['create']>[0];

function startOfShanghaiDay(now: Date): Date {
  const offsetMs = 8 * 60 * 60 * 1000;
  const shifted = new Date(now.getTime() + offsetMs);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - offsetMs,
  );
}

function formatYuan(cents: number): string {
  return (cents / 100)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
}
