import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { CreditService } from '../credits/credit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CatalogVersionService } from '../model/infra/catalog-version.service';
import { UserGroupService } from '../model/user-groups/user-group.service';
import type { Prisma } from '@prisma/client';

/**
 * 会员体系 (落地页订阅卡兑现)。
 *
 * **核心原则: 无会员的用户完全不受影响。**
 * 每次权益查询都返回一份完整的 `ResolvedPerks`, 非会员返回 `DEFAULT_PERKS` 而非 null ——
 * 这样调用方无需写"如果没有会员怎么办"的分支, 也不会因为会员表异常拖垮下单与生成链路。
 * 这是这套设计最重要的约束: 会员是增值项, 不能成为主链路的单点依赖。
 *
 * 权益快照: 下单时把 plan.perks 复制到 membership.perksSnapshot。
 * 运营改套餐不影响存量会员 —— **用户已付的钱要对得起当时承诺的权益**。
 */

export interface Perks {
  /** 走专享快速通道 */
  fastChannel: boolean;
  /** 同时进行中任务上限。0 = 不限 */
  maxConcurrent: number;
  /** 加油包折扣万分比。9500 = 95 折, 10000 = 无折扣 */
  addonDiscountBps: number;
}

/** 非会员 / 系统异常时的兜底权益。
 *
 * 这些值**必须等于"什么都不给"**, 任何一项被调高都会让免费用户拿到会员待遇。
 */
export const DEFAULT_PERKS: Perks = {
  fastChannel: false,
  maxConcurrent: 0,
  addonDiscountBps: 10000,
};

/** perks JSON 的解析与校验。
 *
 * JSON 单字段没有 DB 层校验, 所以解析必须严格:
 * 宁可用默认值, 也不能让脏数据把 maxConcurrent 变成 "abc" 后参与比较。
 */
export function parsePerks(raw: string | null | undefined, fallback: Perks = DEFAULT_PERKS): Perks {
  if (!raw) return { ...fallback };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    // 快照损坏时退回兜底而不是抛错 —— 权益不该让主链路挂掉
    return { ...fallback };
  }
  if (!obj || typeof obj !== 'object') return { ...fallback };

  const o = obj as Record<string, unknown>;
  const num = (v: unknown, def: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
  };

  return {
    fastChannel: o.fastChannel === true,
    maxConcurrent: num(o.maxConcurrent, fallback.maxConcurrent),
    // 折扣上限 10000(=无折扣), 下限 1 —— 超过 10000 会算出负价
    addonDiscountBps: Math.min(10000, Math.max(1, num(o.addonDiscountBps, fallback.addonDiscountBps))),
  };
}

/** 折扣计算。返回优惠后的金额(分), 绝不为负 */
export function applyDiscount(cents: number, bps: number): number {
  if (bps >= 10000 || cents <= 0) return cents;
  return Math.max(0, Math.round((cents * bps) / 10000));
}

export interface ResolvedMembership {
  isMember: boolean;
  planCode: string;
  planName: string;
  perks: Perks;
  expiresAt: string | null;
  /** 会员页展示用 */
  monthlyCredits: number;
  /** 已取消自动续费, 但当前已付周期仍有效 */
  cancelAtPeriodEnd: boolean;
}

/** 已付会员周期。Membership 是一人一行投影，历史必须从订单周期快照还原。 */
export interface MembershipPeriodHistoryItem {
  id: string;
  planCode: string;
  planName: string;
  status: 'active' | 'scheduled' | 'expired' | 'refunded';
  startAt: Date;
  expiresAt: Date;
  monthlyCredits: number;
}

@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credit: CreditService,
    private readonly notifications: NotificationsService,
    private readonly groups: UserGroupService,
    private readonly catalogVersion: CatalogVersionService,
  ) {}

  /**
   * 会员周期变化会改变「有效订单 → 用户分组」的解析结果。
   *
   * 必须在数据库事务提交后调用：先清本进程缓存，再递增跨进程目录版本。
   * 这是支付/退款主链路的后置动作，失败不能反向让已提交的资金与权益变成
   * 500；但必须留下错误日志，靠 30 秒 TTL 兜底恢复。
   */
  async invalidateUserGroupCatalog(): Promise<void> {
    this.groups.invalidate();
    try {
      await this.catalogVersion.invalidate();
    } catch (error) {
      this.logger.error(
        `会员周期已提交，但用户分组目录版本失效失败: ${(error as Error).message}`,
      );
    }
  }

  /**
   * 串行化同一用户的会员投影变更。
   *
   * SQLite 的 deferred transaction 与 PostgreSQL 的 READ COMMITTED 都不会因为
   * “稍后要更新 Membership” 而提前锁住用户。两笔不同的续费订单可以各自更新
   * 自己的订单行，再同时读到同一个旧 `expiresAt`，最后后提交者覆盖前者。
   *
   * 因此所有会重算会员投影的事务必须先对 User 做一次 no-op UPDATE。锁顺序
   * 固定为 User → Order/Membership，与退款记账保持一致，避免反向加锁死锁。
   */
  async lockMembershipProjectionInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE "User" SET "name" = "name" WHERE id = ${userId}`;
  }

  /**
   * 解析用户当前权益。
   *
   * **永不抛错** —— 查会员失败时返回 DEFAULT_PERKS。
   * 会员是增值项, 数据库抖动不该让用户无法下单。
   */
  async resolve(userId: string): Promise<ResolvedMembership> {
    const NON_MEMBER: ResolvedMembership = {
      isMember: false,
      planCode: 'free',
      planName: '普通用户',
      perks: { ...DEFAULT_PERKS },
      expiresAt: null,
      monthlyCredits: 0,
      cancelAtPeriodEnd: false,
    };
    if (!userId) return NON_MEMBER;

    try {
      const now = new Date();
      const m = await this.prisma.membership.findFirst({
        where: { userId },
        include: {
          plan: { select: { code: true, name: true } },
          order: {
            select: {
              membershipPeriodStartAt: true,
              membershipPeriodEndAt: true,
            },
          },
        },
        orderBy: { expiresAt: 'desc' },
      });
      if (!m) return NON_MEMBER;

      /*
       * 已付订单的周期快照才是当前权益的权威来源。Membership 是一人一行的
       * 投影：提前续费会指向未来订单，退掉当前周期后还可能留下未来周期，
       * 单看 Membership.expiresAt 会把未来权益提前生效，也会把周期之间的
       * 空档误判成仍然有效。
       */
      const activePeriod = await this.prisma.order.findFirst({
        where: {
          userId,
          membershipPlanId: { not: null },
          membershipAppliedAt: { not: null },
          membershipPeriodStartAt: { lte: now },
          membershipPeriodEndAt: { gt: now },
          membershipPeriodRevokedAt: null,
          status: { in: ['paid', 'partial_refunded'] },
        },
        select: {
          membershipPeriodEndAt: true,
          membershipPerksSnapshot: true,
          membershipMonthlyCreditsSnapshot: true,
          membershipPlan: { select: { code: true, name: true } },
        },
        orderBy: { membershipPeriodStartAt: 'desc' },
      });
      if (activePeriod?.membershipPeriodEndAt && activePeriod.membershipPlan) {
        return {
          isMember: true,
          planCode: activePeriod.membershipPlan.code,
          planName: activePeriod.membershipPlan.name,
          perks: parsePerks(activePeriod.membershipPerksSnapshot ?? m.perksSnapshot),
          expiresAt: activePeriod.membershipPeriodEndAt.toISOString(),
          monthlyCredits:
            activePeriod.membershipMonthlyCreditsSnapshot ?? m.monthlyCreditsSnapshot,
          cancelAtPeriodEnd: m.status === 'cancelled',
        };
      }

      // 订单已有周期快照却没有覆盖当前时刻，说明用户处于未付费空档。
      if (m.order?.membershipPeriodStartAt || m.order?.membershipPeriodEndAt) {
        return NON_MEMBER;
      }

      // 兼容旧数据：没有订单周期快照时仍按 Membership 投影判断。
      if (
        !['active', 'grace', 'cancelled'].includes(m.status) ||
        m.expiresAt <= now
      ) {
        return NON_MEMBER;
      }
      return {
        isMember: true,
        planCode: m.plan.code,
        planName: m.plan.name,
        // 用快照而非 plan.perks —— 运营改套餐不影响已付费用户
        perks: parsePerks(m.perksSnapshot),
        expiresAt: m.expiresAt.toISOString(),
        monthlyCredits: m.monthlyCreditsSnapshot,
        cancelAtPeriodEnd: m.status === 'cancelled',
      };
    } catch (e) {
      this.logger.warn(`解析会员权益失败, 按非会员处理: ${(e as Error).message}`);
      return NON_MEMBER;
    }
  }

  /** 仅取权益 (热路径用, 避免每次都带 plan) */
  async perksOf(userId: string): Promise<Perks> {
    return (await this.resolve(userId)).perks;
  }

  // ── 权益落地: 并发上限 ────────────────────────────────────────────

  /**
   * 校验并发任务数上限。
   *
   * 计数口径: status ∈ ('pending','running') —— 已排队未开始的也算占位,
   * 否则用户狂点提交可以无限堆积任务, 上限形同虚设。
   *
   * @returns 当前并发数与上限; 超出时抛 400
   */
  async checkConcurrency(userId: string): Promise<{ current: number; limit: number }> {
    const { perks } = await this.resolve(userId);
    if (perks.maxConcurrent <= 0) {
      // 不限 —— 仍返回当前数供 UI 展示
      const current = await this.countActive(userId);
      return { current, limit: 0 };
    }
    const current = await this.countActive(userId);
    if (current >= perks.maxConcurrent) {
      throw new AppError(
        40003,
        `已达会员并发上限 (${perks.maxConcurrent} 个任务进行中),请等待完成或升级会员`,
        400,
      );
    }
    return { current, limit: perks.maxConcurrent };
  }

  private async countActive(userId: string): Promise<number> {
    return this.prisma.generationTask.count({
      // ⚠ GenerationTask 用 ownerId 而非 userId (与 Asset 一致)。
      // 写成 userId 时 Prisma 报 `Unknown argument 'userId'` → 500, 而非 400。
      //
      // 只数用户真正发起的生成: 批量生成的第 2..N 张挂在父任务下 (parentTaskId),
      // 算成一个并发会让「一次生成」按 6 个任务占额度, 会员套餐的并发权益直接失效。
      where: { ownerId: userId, status: { in: ['queued', 'running'] }, parentTaskId: null },
    });
  }

  // ── 权益落地: 加油包折扣 ──────────────────────────────────────────

  /**
   * 计算会员折扣后的订单金额。
   *
   * 折扣**不作用于会员订阅本身的费用** —— 买会员不能用会员折扣买会员,
   * 否则等于第一单半价、第二单 90%…形成无限套利。
   *
   * @returns 折后金额与节省额(分)
   */
  async quoteOrder(userId: string, originalCents: number, opts?: { isSubscription?: boolean }) {
    if (opts?.isSubscription || originalCents <= 0) {
      return { finalCents: originalCents, savedCents: 0, planCode: '' };
    }
    const m = await this.resolve(userId);
    if (!m.isMember || m.perks.addonDiscountBps >= 10000) {
      return { finalCents: originalCents, savedCents: 0, planCode: '' };
    }
    const finalCents = applyDiscount(originalCents, m.perks.addonDiscountBps);
    return {
      finalCents,
      savedCents: originalCents - finalCents,
      planCode: m.planCode,
    };
  }

  /** 记录一笔会员优惠, 供会员页展示"累计省了多少" */
  async recordUsage(userId: string, orderId: string, savedCents: number, planCode: string) {
    if (savedCents <= 0) return;
    await this.prisma.membershipUsage
      .create({ data: { userId, orderId, savedCents, planCode } })
      .catch((e) => {
        // 优惠记录失败不影响订单本身
        this.logger.warn(`记录会员优惠失败: ${(e as Error).message}`);
      });
  }

  // ── 订阅生命周期 ─────────────────────────────────────────────────

  /**
   * 开通或续期订阅。
   *
   * 续期语义: 从 `max(当前到期时间, 现在)` 起顺延 —— 用户提前续费不会损失剩余天数。
   *
   * ## 权益只能由「已支付订单」触发 (2026-10-21 修)
   *
   * 此前本方法不校验任何订单, 任何登录用户直接调用订阅接口就能白拿会员与月度积分。
   * 现在 `orderId` **必填**, 并且逐项核对: 订单存在 → 属于本人 → 已支付 →
   * 买的就是这个套餐。
   *
   * ## 一次性闸门 (`Order.membershipAppliedAt`)
   *
   * 同一笔订单只能兑换一次。闸门放在订单上而不是 `Membership.orderId`:
   * 续费会复用同一行会员并覆盖 orderId, 旧订单因此"看起来没被用过"。
   *
   * 抢占、延期、发积分在**同一事务**内完成, 任何一步失败整体回滚 (闸门一并回滚),
   * 重试是安全的 —— 不会出现"会员延了两期"或"积分发了两遍"。
   */
  async subscribe(params: {
    userId: string;
    planId: string;
    /** 触发本次开通的已支付订单 id。必填 —— 没有订单就没有权益 */
    orderId: string;
  }): Promise<{
    membershipId: string | null;
    expiresAt: string | null;
    planCode: string;
    /** true = 该订单此前已兑换过, 本次未重复发放 */
    alreadyApplied: boolean;
  }> {
    const order = await this.prisma.order.findUnique({
      where: { id: params.orderId },
      select: {
        id: true,
        userId: true,
        status: true,
        membershipPlanId: true,
        membershipPerksSnapshot: true,
        membershipMonthlyCreditsSnapshot: true,
        membershipDurationDaysSnapshot: true,
        membershipUserGroupCodeSnapshot: true,
        orderNo: true,
      },
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);
    if (order.userId !== params.userId) {
      throw new AppError(40301, '无权使用该订单', 403);
    }
    if (order.status !== 'paid' && order.status !== 'partial_refunded') {
      throw new AppError(40901, '订单未支付, 不能开通会员', 409);
    }
    if (order.membershipPlanId !== params.planId) {
      throw new AppError(40001, '订单与会员套餐不匹配', 400);
    }

    const plan = await this.prisma.membershipPlan.findUnique({ where: { id: params.planId } });
    if (!plan) throw new AppError(40400, '会员套餐不存在', 404);
    /*
     * ⚠ 这里**不校验 plan.status** —— 用户付款时套餐是可售的, 之后运营下架
     * 不该让已付款的订单永远开通不了。"是否可购买"是下单时的判定 (OrderService.create)。
     */
    const durationDays = order.membershipDurationDaysSnapshot ?? plan.durationDays;
    const monthlyCredits = order.membershipMonthlyCreditsSnapshot ?? plan.monthlyCredits;
    const orderPerksSnapshot =
      order.membershipPerksSnapshot ?? JSON.stringify(parsePerks(plan.perks));
    // 历史待支付订单没有分组快照时，只能在兑换时回退到当前套餐配置。
    const userGroupCode =
      order.membershipUserGroupCodeSnapshot ?? plan.userGroupCode ?? '';
    if (durationDays <= 0) {
      throw new AppError(40001, '默认套餐不支持购买', 400);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 同一用户的并发续费必须串行重算到期时间；先锁 User，再抢订单闸门。
      await this.lockMembershipProjectionInTransaction(tx, params.userId);

      // 一次性闸门: 只有闸门从 null 变成时间戳的那次调用能继续往下走
      const claim = await tx.order.updateMany({
        where: {
          id: order.id,
          status: { in: ['paid', 'partial_refunded'] },
          membershipAppliedAt: null,
        },
        data: { membershipAppliedAt: new Date() },
      });
      if (claim.count === 0) return { claimed: false as const };

      const now = new Date();
      const current = await tx.membership.findFirst({
        // Membership 是用户级投影，不是每次订阅新增一行。过期后重新订阅也必须
        // 复用原行；否则 refund/resolve/scheduler 的 findFirst 会逐渐产生歧义。
        where: { userId: params.userId },
        orderBy: [{ expiresAt: 'desc' }, { createdAt: 'desc' }],
      });

      // 从当前到期时间顺延, 已过期则从现在开始。提前续费的新周期尚未开始，
      // 因此不能立即发放新周期积分，也不能提前覆盖当前周期的套餐权益。
      const hasCurrentPeriod = Boolean(
        current &&
          ['active', 'grace', 'cancelled'].includes(current.status) &&
          current.expiresAt > now,
      );
      const periodStartAt = hasCurrentPeriod ? current!.expiresAt : now;
      const startsImmediately = !hasCurrentPeriod;
      const expiresAt = new Date(
        periodStartAt.getTime() + durationDays * 24 * 3600 * 1000,
      );
      const nextMonthlyCreditAt = new Date(
        periodStartAt.getTime() + 30 * 24 * 3600 * 1000,
      );
      const nextCreditAt = startsImmediately
        ? monthlyCredits > 0
          ? new Date(Math.min(expiresAt.getTime(), nextMonthlyCreditAt.getTime()))
          : null
        : current?.nextCreditAt &&
            current.nextCreditAt.getTime() <= periodStartAt.getTime()
          ? current.nextCreditAt
          :
            /*
             * 提前续费即使新套餐月积分为 0，也必须在该周期开始时唤醒调度器
             * 切换 Membership 投影。否则后台套餐/用户分组会一直停留在上一期。
             */
            periodStartAt;
      const keepCurrentProjection = hasCurrentPeriod && current !== null;
      const membership = current
        ? await tx.membership.update({
            where: { id: current.id },
            data: {
              planId: keepCurrentProjection ? current.planId : plan.id,
              status: 'active',
              perksSnapshot: keepCurrentProjection
                ? current.perksSnapshot
                : orderPerksSnapshot,
              monthlyCreditsSnapshot: keepCurrentProjection
                ? current.monthlyCreditsSnapshot
                : monthlyCredits,
              startAt: keepCurrentProjection ? current.startAt : now,
              expiresAt,
              nextCreditAt,
              orderId: params.orderId,
            },
          })
        : await tx.membership.create({
            data: {
              userId: params.userId,
              planId: plan.id,
              status: 'active',
              perksSnapshot: orderPerksSnapshot,
              monthlyCreditsSnapshot: monthlyCredits,
              startAt: now,
              expiresAt,
              nextCreditAt,
              orderId: params.orderId,
            },
          });

      /*
       * 周期快照必须落在触发它的订单上, 而不是只更新当前 Membership。
       * Membership 是一人一行的投影, 续费会覆盖 orderId/expiresAt; 没有
       * 订单级快照时, 退款既找不到旧订单买的区间, 也无法判断退掉的是哪一期。
       */
      await tx.order.update({
        where: { id: order.id },
        data: {
          membershipPeriodStartAt: periodStartAt,
          membershipPeriodEndAt: expiresAt,
          membershipPerksSnapshot: orderPerksSnapshot,
          membershipMonthlyCreditsSnapshot: monthlyCredits,
          membershipDurationDaysSnapshot: durationDays,
          membershipUserGroupCodeSnapshot: userGroupCode,
          membershipPeriodRevokedAt: null,
        },
      });

      // 只有周期真正从当前时刻开始时才立即发首期积分；提前续费要等到
      // 新周期开始，由调度器按该周期订单发放。
      if (startsImmediately && monthlyCredits > 0) {
        const granted = await this.credit.grant(
          {
            userId: params.userId,
            credits: monthlyCredits,
            source: 'grant',
            // 月度赠送积分不滚存；首期与后续月份统一 30 天有效
            validDays: 30,
            orderId: params.orderId,
            idempotencyKey: `membership-initial:${params.orderId}`,
            reason: `会员订阅积分 (${plan.name})`,
          },
          tx,
        );
        if (!granted.idempotentHit) {
          // 退款按实际发放账本回收，不能把尚未到账的积分预记到订单上。
          await tx.order.update({
            where: { id: order.id },
            data: { grantedCredits: { increment: monthlyCredits } },
          });
        }
      }

      return { claimed: true as const, membershipId: membership.id, expiresAt };
    });

    if (!result.claimed) {
      /*
       * 已被兑换过: 幂等返回当前会员状态, **不重复发权益**。
       * 重复回调、前端重复提交、调度重试都会走到这里。
       */
      const current = await this.prisma.membership.findFirst({
        where: { userId: params.userId },
        orderBy: { expiresAt: 'desc' },
      });
      this.logger.log(`会员订单重复兑换已忽略: order=${order.orderNo} user=${params.userId}`);
      return {
        membershipId: current?.id ?? null,
        expiresAt: current?.expiresAt.toISOString() ?? null,
        planCode: plan.code,
        alreadyApplied: true,
      };
    }

    await this.invalidateUserGroupCatalog();

    this.logger.log(
      `会员开通/续期: user=${params.userId} plan=${plan.code} 到期=${result.expiresAt.toISOString()} order=${order.orderNo}`,
    );
    return {
      membershipId: result.membershipId,
      expiresAt: result.expiresAt.toISOString(),
      planCode: plan.code,
      alreadyApplied: false,
    };
  }

  /**
   * 全额退款时撤销某一笔订单产生的会员周期。
   *
   * 调用方必须传入退款记账事务，保证「订单退款成功、积分扣回、会员周期撤销、
   * 会员投影重算」同生共死。撤销的是订单级周期快照，不是整条 Membership：
   *   · 退最新一期 → 回退到仍在付费的上一期到期时间；
   *   · 退较早一期 → 当前有效周期不受影响；
   *   · 最后一期退款 → 立即失效并停发后续月度积分。
   *
   * 对旧数据（periodEndAt 为空）保留一次保守降级：只有 Membership.orderId
   * 仍指向本单时才终止，避免无法证明归属的旧周期被误撤。
   */
  async revokeOrderPeriodInTransaction(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<{
    affected: boolean;
    terminated: boolean;
    remainingExpiresAt: string | null;
    revokedPeriodStartAt: string | null;
    revokedPeriodEndAt: string | null;
  }> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        status: true,
        membershipPlanId: true,
        membershipAppliedAt: true,
        membershipPeriodStartAt: true,
        membershipPeriodEndAt: true,
        membershipPeriodRevokedAt: true,
      },
    });
    if (!order?.membershipPlanId || !order.membershipAppliedAt) {
      return {
        affected: false,
        terminated: false,
        remainingExpiresAt: null,
        revokedPeriodStartAt: null,
        revokedPeriodEndAt: null,
      };
    }

    // 两笔不同订单并发退款时，也必须串行重算剩余周期与 Membership 投影。
    await this.lockMembershipProjectionInTransaction(tx, order.userId);

    const now = new Date();
    const current = await tx.membership.findFirst({
      where: { userId: order.userId },
      orderBy: { createdAt: 'desc' },
    });
    // 退款事务会先把订单状态改成 refunded，再调用本方法；此时不能再按
    // status=paid 判断。订单自身的周期快照已足以说明退款前是否覆盖当前时刻。
    const wasEntitled = Boolean(
      !order.membershipPeriodRevokedAt &&
        order.membershipPeriodStartAt &&
        order.membershipPeriodStartAt <= now &&
        order.membershipPeriodEndAt &&
        order.membershipPeriodEndAt > now,
    );

    // 旧订单没有订单级周期快照，无法安全重算历史区间，保守处理当前行。
    if (!order.membershipPeriodEndAt) {
      const ended = await tx.membership.updateMany({
        where: {
          userId: order.userId,
          orderId: order.id,
          status: { in: ['active', 'grace', 'cancelled'] },
        },
        data: { status: 'expired', expiresAt: now, nextCreditAt: null, orderId: null },
      });
      return {
        affected: ended.count > 0,
        terminated: ended.count > 0,
        remainingExpiresAt: null,
        revokedPeriodStartAt: null,
        revokedPeriodEndAt: null,
      };
    }

    const revokedAt = new Date();
    const revoked = await tx.order.updateMany({
      where: { id: order.id, membershipPeriodRevokedAt: null },
      data: { membershipPeriodRevokedAt: revokedAt },
    });
    if (revoked.count === 0) {
      return {
        affected: false,
        terminated: false,
        remainingExpiresAt: current?.expiresAt.toISOString() ?? null,
        revokedPeriodStartAt: order.membershipPeriodStartAt?.toISOString() ?? null,
        revokedPeriodEndAt: order.membershipPeriodEndAt.toISOString(),
      };
    }

    const remaining = await tx.order.findMany({
      where: {
        userId: order.userId,
        membershipPlanId: { not: null },
        membershipAppliedAt: { not: null },
        membershipPeriodEndAt: { not: null },
        membershipPeriodRevokedAt: null,
        status: { in: ['paid', 'partial_refunded'] },
      },
      select: {
        id: true,
        membershipPlanId: true,
        membershipPeriodStartAt: true,
        membershipPeriodEndAt: true,
        membershipPerksSnapshot: true,
        membershipMonthlyCreditsSnapshot: true,
      },
      orderBy: [
        { membershipPeriodEndAt: 'desc' },
        { membershipPeriodStartAt: 'desc' },
      ],
    });

    const finalEndAt = remaining.length
      ? new Date(
          Math.max(
            ...remaining.map((period) => period.membershipPeriodEndAt!.getTime()),
          ),
        )
      : null;
    const activePeriod = remaining
      .filter(
        (period) =>
          period.membershipPeriodStartAt !== null &&
          period.membershipPeriodStartAt <= now &&
          period.membershipPeriodEndAt! > now,
      )
      .sort(
        (a, b) =>
          b.membershipPeriodStartAt!.getTime() -
          a.membershipPeriodStartAt!.getTime(),
      )[0];
    const futurePeriod = remaining
      .filter(
        (period) =>
          period.membershipPeriodStartAt !== null &&
          period.membershipPeriodStartAt > now,
      )
      .sort(
        (a, b) =>
          a.membershipPeriodStartAt!.getTime() -
          b.membershipPeriodStartAt!.getTime(),
      )[0];
    const projection = activePeriod ?? futurePeriod;
    const stillEntitled = Boolean(activePeriod);

    if (!current) {
      return {
        affected: true,
        terminated: wasEntitled && !stillEntitled,
        remainingExpiresAt: finalEndAt?.toISOString() ?? null,
        revokedPeriodStartAt: order.membershipPeriodStartAt?.toISOString() ?? null,
        revokedPeriodEndAt: order.membershipPeriodEndAt.toISOString(),
      };
    }

    if (!projection) {
      /*
       * 没有当前或未来已付周期时直接置 expired；订单快照仍保留原边界用于审计。
       */
      await tx.membership.update({
        where: { id: current.id },
        data: {
          status: 'expired',
          expiresAt: now,
          nextCreditAt: null,
          orderId: null,
        },
      });
      return {
        affected: true,
        terminated: wasEntitled && !stillEntitled,
        remainingExpiresAt: null,
        revokedPeriodStartAt: order.membershipPeriodStartAt?.toISOString() ?? null,
        revokedPeriodEndAt: order.membershipPeriodEndAt.toISOString(),
      };
    }

    const status = current.status === 'cancelled'
      ? 'cancelled'
      : current.status === 'grace'
        ? 'grace'
        : 'active';
    /*
     * 保留尚未越界的发分计划；若当前没有计划但还有未来周期，则用最近一期
     * 的开始时间唤醒调度器，既切换权益投影，也发放该期首月积分。
     */
    const pendingCreditAt =
      current.nextCreditAt && current.nextCreditAt < finalEndAt!
        ? current.nextCreditAt
        : null;
    const nextCreditAt = pendingCreditAt ?? futurePeriod?.membershipPeriodStartAt ?? null;

    await tx.membership.update({
      where: { id: current.id },
      data: {
        planId: projection.membershipPlanId!,
        perksSnapshot:
          projection.membershipPerksSnapshot ?? current.perksSnapshot,
        monthlyCreditsSnapshot:
          projection.membershipMonthlyCreditsSnapshot ??
          current.monthlyCreditsSnapshot,
        startAt: projection.membershipPeriodStartAt ?? current.startAt,
        expiresAt: finalEndAt!,
        status,
        nextCreditAt,
        orderId: projection.id,
      },
    });

    return {
      affected: true,
      terminated: wasEntitled && !stillEntitled,
      remainingExpiresAt: finalEndAt!.toISOString(),
      revokedPeriodStartAt: order.membershipPeriodStartAt?.toISOString() ?? null,
      revokedPeriodEndAt: order.membershipPeriodEndAt.toISOString(),
    };
  }

  /**
   * 取消订阅。
   *
   * 保留到当前周期结束 —— 已付的钱不能立刻作废, 这是用户权益的基本尊重。
   * 立即退款属退款流程, 不在此处理。
   */
  async cancel(userId: string): Promise<{ expiresAt: string }> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockMembershipProjectionInTransaction(tx, userId);
      const m = await tx.membership.findFirst({
        // cancelled 也要能查到: 重复点「取消续费」应幂等返回同一到期时间,
        // 而不是报「没有生效中的会员」让用户以为第一次没生效。
        where: { userId, status: { in: ['active', 'grace', 'cancelled'] }, expiresAt: { gt: new Date() } },
        orderBy: { expiresAt: 'desc' },
      });
      if (!m) throw new AppError(40400, '没有生效中的会员', 404);

      // 已经取消过: 不再改状态, 直接回同一到期时间
      if (m.status === 'cancelled') return m;

      /*
       * 已付周期保留到 `expiresAt`，只停止自动续费。
       *
       * 旧实现把状态置 cancelled 后 `resolve()` 又只认 active/grace，导致用户
       * 刚点完取消就立刻失去会员 —— 与确认框承诺的「权益保留至到期日」不符。
       * 现在 resolve() 也接受 cancelled，到期由调度任务统一失效。
       */
      return tx.membership.update({
        where: { id: m.id },
        data: {
          // 查询已限定 expiresAt > now，所以这里一定是「未到期」的取消。
          // 只停止未来续费，不停止已付费周期内的月度积分；nextCreditAt 必须保留，
          // 否则提前买好的未来周期到点后不会发积分。
          status: 'cancelled',
        },
      });
    });

    // expiresAt 保持不变: cancelled 在到期前仍算会员, 只是不再自动续费
    this.logger.log(`会员取消: user=${userId}, 权益保留至 ${updated.expiresAt.toISOString()}`);
    return { expiresAt: updated.expiresAt.toISOString() };
  }

  // ── 调度任务: 到期处理与积分发放 ──────────────────────────────────

  /**
   * 会员到期处理与月度积分发放。
   *
   * 两件事:
   *   1. 已过期但status 仍是 active 的 → 转 expired (宽限期内保留权益)
   *   2. nextCreditAt 已到 → 发当月积分并把下次时间 +30 天
   *
   * ⚠ 宽限期: 给用户缓冲。直接失效会让"忘记续费"变成权益突然消失。
   */
  async runSchedulerTasks(): Promise<{
    expired: number;
    creditsGranted: number;
    creditsIssued: number;
  }> {
    const now = new Date();

    // 1) 到期转expired
    //    逐条条件更新：并发调度时只有把 status 真正改为 expired 的那一轮发通知，
    //    避免两个实例同时读到到期记录后重复通知。
    const expiring = await this.prisma.membership.findMany({
      // cancelled 也要在周期结束时真正失效, 否则会永远保留权益。
      where: { status: { in: ['active', 'grace', 'cancelled'] }, expiresAt: { lte: now } },
      select: { id: true, userId: true, expiresAt: true },
    });
    const expired: typeof expiring = [];
    for (const m of expiring) {
      const transitioned = await this.prisma.membership.updateMany({
        where: {
          id: m.id,
          status: { in: ['active', 'grace', 'cancelled'] },
          expiresAt: { lte: now },
        },
        data: { status: 'expired', nextCreditAt: null },
      });
      if (transitioned.count > 0) expired.push(m);
    }
    let membershipProjectionChanged = expired.length > 0;

    // 2) 发月度积分
    const due = await this.prisma.membership.findMany({
      // cancelled 表示不再自动续费，但用户已经付过的当前/未来周期仍应发分。
      where: {
        status: { in: ['active', 'cancelled'] },
        nextCreditAt: { lte: now },
      },
      take: 200,
    });

    let creditsGranted = 0;
    let creditsIssued = 0;
    for (const m of due) {
      if (!m.nextCreditAt) continue;
      try {
        const outcome = await this.prisma.$transaction(async (tx) => {
          // 先锁用户，再重读会员：等待锁期间续费/退款可能已推进到期时间或
          // nextCreditAt，不能继续使用事务外读到的旧投影做发分与计划计算。
          await this.lockMembershipProjectionInTransaction(tx, m.userId);
          const current = await tx.membership.findUnique({ where: { id: m.id } });
          if (
            !current ||
            !current.nextCreditAt ||
            current.nextCreditAt.getTime() !== m.nextCreditAt!.getTime() ||
            !['active', 'cancelled'].includes(current.status)
          ) {
            return { issued: 0, projectionChanged: false };
          }

          // 条件更新与发积分同事务：发积分失败时 nextCreditAt 回滚，下轮可重试。
          const claimed = await tx.membership.updateMany({
            where: {
              id: current.id,
              status: { in: ['active', 'cancelled'] },
              nextCreditAt: current.nextCreditAt,
            },
            data: {
              nextCreditAt: new Date(current.nextCreditAt.getTime() + 30 * 24 * 3600 * 1000),
            },
          });
          if (claimed.count === 0) {
            return { issued: 0, projectionChanged: false };
          }

          /*
           * 月度积分必须归属到 nextCreditAt 所在的那一笔已付会员周期。
           * 仅看 Membership.orderId 不够：提前续费后它指向最新一期，不能代表
           * 本次发分发生在哪一期。周期归属写进 CreditLot.orderId 后，退款
           * 才能通过 reclaimForOrder 精确回收该订单实际发出的全部月度积分。
           */
          const dueAt = current.nextCreditAt;
          const periodOrder = await tx.order.findFirst({
            where: {
              userId: current.userId,
              membershipPlanId: { not: null },
              membershipAppliedAt: { not: null },
              membershipPeriodStartAt: { lte: dueAt },
              membershipPeriodEndAt: { gt: dueAt },
              membershipPeriodRevokedAt: null,
              status: { in: ['paid', 'partial_refunded'] },
            },
            orderBy: [{ membershipPeriodStartAt: 'desc' }],
            select: {
              id: true,
              membershipPlanId: true,
              membershipPerksSnapshot: true,
              membershipMonthlyCreditsSnapshot: true,
            },
          });
          // 旧数据的 Membership.orderId 是唯一可用归属；仅当旧订单没有周期快照
          // 或周期确实覆盖 dueAt 时才兜底，避免把已撤销周期的积分挂到续费单。
          const fallbackOrder = !periodOrder && current.orderId
            ? await tx.order.findFirst({
                where: {
                  id: current.orderId,
                  userId: current.userId,
                  membershipAppliedAt: { not: null },
                  membershipPeriodRevokedAt: null,
                  status: { in: ['paid', 'partial_refunded'] },
                  OR: [
                    { membershipPeriodStartAt: null, membershipPeriodEndAt: null },
                    {
                      membershipPeriodStartAt: { lte: dueAt },
                      membershipPeriodEndAt: { gt: dueAt },
                    },
                  ],
                },
                select: {
                  id: true,
                  membershipPlanId: true,
                  membershipPerksSnapshot: true,
                  membershipMonthlyCreditsSnapshot: true,
                },
              })
            : null;
          const creditOrder = periodOrder ?? fallbackOrder;
          if (!creditOrder) {
            /*
             * 必须让事务回滚 nextCreditAt。此前只记一条 warn 后正常返回，事务会把
             * nextCreditAt 推进 30 天，积分却永远不再重试，造成静默漏发。
             */
            throw new Error(
              `找不到会员月度积分归属订单 user=${current.userId} due=${dueAt.toISOString()}`,
            );
          }

          const credits =
            creditOrder.membershipMonthlyCreditsSnapshot ??
            current.monthlyCreditsSnapshot;

          /*
           * 下一站点取「30 天后」和「下一期开始」中更早者。标准 30 天套餐
           * 两者相同；非 30 天周期或年卡则必须在新周期开始就切换权益并发放
           * 首月积分，不能机械地再等 30 天而漏掉新周期开头。
           */
          const nextPeriod = await tx.order.findFirst({
            where: {
              userId: current.userId,
              membershipPlanId: { not: null },
              membershipAppliedAt: { not: null },
              membershipPeriodStartAt: { gt: dueAt },
              membershipPeriodRevokedAt: null,
              status: { in: ['paid', 'partial_refunded'] },
            },
            orderBy: [{ membershipPeriodStartAt: 'asc' }],
            select: { membershipPeriodStartAt: true },
          });
          const nextMonthlyAt = new Date(
            dueAt.getTime() + 30 * 24 * 3600 * 1000,
          );
          const nextEventAt = credits > 0
            ? nextPeriod?.membershipPeriodStartAt &&
              nextPeriod.membershipPeriodStartAt < nextMonthlyAt
              ? nextPeriod.membershipPeriodStartAt
              : nextMonthlyAt
            : nextPeriod?.membershipPeriodStartAt ?? null;
          const nextCreditAt =
            nextEventAt && nextEventAt < current.expiresAt ? nextEventAt : null;

          // 到达新周期后把 Membership 投影切到该周期套餐；即使该期积分为 0，
          // 投影也必须切换，否则后台套餐和用户分组会停留在上一期。
          await tx.membership.update({
            where: { id: current.id },
            data: {
              ...(periodOrder?.membershipPlanId
                ? {
                    planId: periodOrder.membershipPlanId,
                    perksSnapshot:
                      periodOrder.membershipPerksSnapshot ?? current.perksSnapshot,
                    monthlyCreditsSnapshot:
                      periodOrder.membershipMonthlyCreditsSnapshot ??
                      current.monthlyCreditsSnapshot,
                  }
                : {}),
              nextCreditAt,
            },
          });

          if (credits <= 0) {
            return { issued: 0, projectionChanged: true };
          }

          const granted = await this.credit.grant(
            {
              userId: current.userId,
              credits,
              source: 'grant',
              validDays: 30,
              orderId: creditOrder.id,
              idempotencyKey: `membership-monthly:${current.id}:${dueAt.toISOString()}`,
              reason: '会员月度积分',
            },
            tx,
          );
          if (granted.idempotentHit) {
            return { issued: 0, projectionChanged: true };
          }

          // grantedCredits 是退款回收的账本上限，必须与 CreditLot 同事务累加。
          const bumped = await tx.order.updateMany({
            where: {
              id: creditOrder.id,
              userId: current.userId,
              status: { in: ['paid', 'partial_refunded'] },
              membershipPeriodRevokedAt: null,
            },
            data: { grantedCredits: { increment: credits } },
          });
          if (bumped.count === 0) {
            throw new Error('会员月度积分归属订单已不可发放');
          }
          return { issued: credits, projectionChanged: true };
        });
        if (outcome.issued > 0) {
          creditsGranted += 1;
          creditsIssued += outcome.issued;
        }
        if (outcome.projectionChanged) membershipProjectionChanged = true;
      } catch (e) {
        this.logger.warn(`会员月度积分发放失败 user=${m.userId}: ${(e as Error).message}`);
      }
    }

    if (membershipProjectionChanged) {
      await this.invalidateUserGroupCatalog();
    }

    // 到期通知 (B4)。只给本调度实例真正完成状态迁移的用户发。
    for (const m of expired) {
      await this.notifications.notify({
        userId: m.userId,
        type: 'membership_expired',
        vars: { date: m.expiresAt.toISOString().slice(0, 10) },
        fallbackTitle: '会员已到期',
        fallbackBody: `你的会员已于 ${m.expiresAt.toISOString().slice(0, 10)} 到期。`,
        link: '/packages',
      });
    }

    if (expired.length > 0 || creditsGranted > 0) {
      this.logger.log(
        `会员调度: ${expired.length} 个到期, ${creditsGranted} 个发放积分, 共 ${creditsIssued} 积分`,
      );
    }
    return { expired: expired.length, creditsGranted, creditsIssued };
  }

  // ── 查询 ──────────────────────────────────────────────────────────

  /**
   * 订阅周期历史。
   *
   * `Membership` 只保留用户当前投影，续费会覆盖同一行，不能拿来当历史列表。
   * 真正的历史来源是已兑换会员的订单周期快照；退款后也保留原区间和撤销标记，
   * 便于客服核对“哪一笔订单买的是哪一段”。
   *
   * 对加列前的纯旧数据仍回退到 Membership 投影，避免历史页突然全空。
   */
  async historyOf(userId: string, take = 10): Promise<MembershipPeriodHistoryItem[]> {
    const limit = Math.min(Math.max(Number(take) || 10, 1), 50);
    const now = Date.now();
    const periods = await this.prisma.order.findMany({
      where: {
        userId,
        membershipPlanId: { not: null },
        membershipAppliedAt: { not: null },
        membershipPeriodStartAt: { not: null },
        membershipPeriodEndAt: { not: null },
      },
      orderBy: [{ membershipPeriodStartAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        status: true,
        membershipPeriodStartAt: true,
        membershipPeriodEndAt: true,
        membershipPeriodRevokedAt: true,
        membershipMonthlyCreditsSnapshot: true,
        membershipPlan: { select: { code: true, name: true } },
      },
    });

    if (periods.length > 0) {
      return periods.flatMap((period) => {
        if (
          !period.membershipPlan ||
          !period.membershipPeriodStartAt ||
          !period.membershipPeriodEndAt
        ) {
          return [];
        }
        const status: MembershipPeriodHistoryItem['status'] =
          period.membershipPeriodRevokedAt || period.status === 'refunded'
            ? 'refunded'
            : period.membershipPeriodStartAt.getTime() > now
              ? 'scheduled'
              : period.membershipPeriodEndAt.getTime() <= now
                ? 'expired'
                : 'active';
        return [{
          id: period.id,
          planCode: period.membershipPlan.code,
          planName: period.membershipPlan.name,
          status,
          startAt: period.membershipPeriodStartAt,
          expiresAt: period.membershipPeriodEndAt,
          monthlyCredits: period.membershipMonthlyCreditsSnapshot ?? 0,
        }];
      });
    }

    const legacy = await this.prisma.membership.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      include: { plan: { select: { code: true, name: true } } },
    });
    return legacy.map((membership) => ({
      id: membership.id,
      planCode: membership.plan.code,
      planName: membership.plan.name,
      status:
        ['active', 'grace', 'cancelled'].includes(membership.status) &&
        membership.expiresAt.getTime() > now
          ? 'active'
          : 'expired',
      startAt: membership.startAt,
      expiresAt: membership.expiresAt,
      monthlyCredits: membership.monthlyCreditsSnapshot,
    }));
  }

  /** 我的会员详情 */
  async detailOf(userId: string) {
    const resolved = await this.resolve(userId);
    const history = await this.historyOf(userId, 10);

    const usage = await this.prisma.membershipUsage.aggregate({
      where: { userId },
      _sum: { savedCents: true },
      _count: { _all: true },
    });

    return {
      ...resolved,
      totalSavedCents: usage._sum.savedCents ?? 0,
      totalSavedYuan: ((usage._sum.savedCents ?? 0) / 100).toFixed(2),
      discountedOrders: usage._count._all,
      history,
    };
  }

  /** 套餐列表 (C 端展示) */
  /**
   * 单个套餐（含已下架）。
   *
   * 只用于「续付既有会员订单」：订单已经按套餐快照创建，套餐后来下架
   * 不应让 pending 订单永久无法支付。公开列表仍只返回 active。
   */
  async planById(planId: string) {
    const p = await this.prisma.membershipPlan.findUnique({ where: { id: planId } });
    if (!p) return null;
    const perks = parsePerks(p.perks);
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      priceCents: p.priceCents,
      priceYuan: (p.priceCents / 100).toFixed(2),
      durationDays: p.durationDays,
      monthlyCredits: p.monthlyCredits,
      perks,
      perkLabels: buildPerkLabels(perks, p.monthlyCredits),
    };
  }

  async listPlans() {
    const plans = await this.prisma.membershipPlan.findMany({
      where: { status: 'active' },
      orderBy: { sortOrder: 'asc' },
    });
    return plans.map((p) => {
      const perks = parsePerks(p.perks);
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        priceYuan: (p.priceCents / 100).toFixed(2),
        durationDays: p.durationDays,
        monthlyCredits: p.monthlyCredits,
        perks,
        /** 权益文案, 供前端直接渲染, 避免前端各自拼 */
        perkLabels: buildPerkLabels(perks, p.monthlyCredits),
      };
    });
  }
}

/** 权益 → 用户能看懂的话。
 *
 * 由后端生成而非前端拼: 权益定义在后端, 文案理应跟着定义走,
 * 否则改权益时前端文案会漏改, 变成"宣传页写的和实际不一样"。
 */
export function buildPerkLabels(perks: Perks, monthlyCredits = 0): string[] {
  const labels: string[] = [];
  // 0 配额不发积分 —— 免费档写「订阅期内含积分」是假话, 直接不出这条
  if (monthlyCredits > 0) labels.push(`每月赠送 ${monthlyCredits} 积分`);
  if (perks.fastChannel) labels.push('专享快速生成通道');
  if (perks.maxConcurrent > 0) labels.push(`同时处理 ${perks.maxConcurrent} 个任务`);
  else labels.push('不限并发任务数');
  if (perks.addonDiscountBps < 10000) {
    const zhe = (perks.addonDiscountBps / 1000).toFixed(2).replace(/\.?0+$/, '');
    labels.push(`加油包${zhe} 折`);
  } else {
    labels.push('加油包无折扣');
  }
  return labels.filter(Boolean);
}
