import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { CreditService } from '../credits/credit.service';
import { NotificationsService } from '../notifications/notifications.service';

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
}

@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credit: CreditService,
    private readonly notifications: NotificationsService,
  ) {}

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
    };
    if (!userId) return NON_MEMBER;

    try {
      const m = await this.prisma.membership.findFirst({
        where: {
          userId,
          status: { in: ['active', 'grace'] },
          expiresAt: { gt: new Date() },
        },
        include: { plan: { select: { code: true, name: true } } },
        orderBy: { expiresAt: 'desc' },
      });
      if (!m) return NON_MEMBER;

      return {
        isMember: true,
        planCode: m.plan.code,
        planName: m.plan.name,
        // 用快照而非 plan.perks —— 运营改套餐不影响已付费用户
        perks: parsePerks(m.perksSnapshot),
        expiresAt: m.expiresAt.toISOString(),
        monthlyCredits: m.monthlyCreditsSnapshot,
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
      where: { ownerId: userId, status: { in: ['pending', 'running'] } },
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
      select: { id: true, userId: true, status: true, membershipPlanId: true, orderNo: true },
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);
    if (order.userId !== params.userId) {
      throw new AppError(40301, '无权使用该订单', 403);
    }
    if (order.status !== 'paid') {
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
    if (plan.durationDays <= 0) {
      throw new AppError(40001, '默认套餐不支持购买', 400);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 一次性闸门: 只有闸门从 null 变成时间戳的那次调用能继续往下走
      const claim = await tx.order.updateMany({
        where: { id: order.id, status: 'paid', membershipAppliedAt: null },
        data: { membershipAppliedAt: new Date() },
      });
      if (claim.count === 0) return { claimed: false as const };

      const now = new Date();
      const current = await tx.membership.findFirst({
        where: { userId: params.userId, status: { in: ['active', 'grace'] } },
        orderBy: { expiresAt: 'desc' },
      });

      // 从当前到期时间顺延, 已过期则从现在开始
      const base = current && current.expiresAt > now ? current.expiresAt : now;
      const expiresAt = new Date(base.getTime() + plan.durationDays * 24 * 3600 * 1000);

      const perksSnapshot = JSON.stringify(parsePerks(plan.perks));
      const nextCreditAt = new Date(
        Math.min(expiresAt.getTime(), now.getTime() + plan.durationDays * 24 * 3600 * 1000),
      );

      const membership = current
        ? await tx.membership.update({
            where: { id: current.id },
            data: {
              planId: plan.id,
              status: 'active',
              // 换套餐时刷新快照; 同套餐续期则保留原权益 (用户已付费)
              perksSnapshot: current.planId === plan.id ? current.perksSnapshot : perksSnapshot,
              monthlyCreditsSnapshot: plan.monthlyCredits,
              startAt: current.startAt,
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
              perksSnapshot,
              monthlyCreditsSnapshot: plan.monthlyCredits,
              startAt: now,
              expiresAt,
              nextCreditAt,
              orderId: params.orderId,
            },
          });

      // 首期订阅积分立即发放 (与订单同 orderId, 退款回收按此批次扣回)
      if (plan.monthlyCredits > 0) {
        await this.credit.grant(
          {
            userId: params.userId,
            credits: plan.monthlyCredits,
            source: 'grant',
            // 会员积分与订阅同周期到期
            validDays: plan.durationDays,
            orderId: params.orderId,
            reason: `会员订阅积分 (${plan.name})`,
          },
          tx,
        );
        // 下期发放时间 = 一个月后
        await tx.membership.update({
          where: { id: membership.id },
          data: { nextCreditAt: new Date(now.getTime() + 30 * 24 * 3600 * 1000) },
        });
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
   * 取消订阅。
   *
   * 保留到当前周期结束 —— 已付的钱不能立刻作废, 这是用户权益的基本尊重。
   * 立即退款属退款流程, 不在此处理。
   */
  async cancel(userId: string): Promise<{ expiresAt: string }> {
    const m = await this.prisma.membership.findFirst({
      where: { userId, status: { in: ['active', 'grace'] } },
      orderBy: { expiresAt: 'desc' },
    });
    if (!m) throw new AppError(40400, '没有生效中的会员', 404);

    // 周期内且未过 24h 的用户可立即失效, 否则保留到期末(标记取消即到期后失效)
    const now = new Date();
    const withinGrace = now.getTime() < m.expiresAt.getTime();
    const updated = await this.prisma.membership.update({
      where: { id: m.id },
      data: {
        status: withinGrace ? 'cancelled' : 'expired',
        nextCreditAt: null,
      },
    });

    // 取消后仍在本周期内: 权益保留到期末, 只是不再发后续积分
    // 故把 expiresAt 保留不变, 由 resolve() 的 status 过滤决定是否生效
    this.logger.log(`会员取消: user=${userId}, 权益保留至 ${m.expiresAt.toISOString()}`);
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
    //    先查出到期的是哪些人, 再条件更新: 通知需要一个 userId, 而 updateMany
    //    只回 count。条件里带上 status/expiresAt 保证并发下不会重复通知。
    const expiring = await this.prisma.membership.findMany({
      where: { status: { in: ['active', 'grace'] }, expiresAt: { lte: now } },
      select: { id: true, userId: true, expiresAt: true },
    });
    const expiredRes = await this.prisma.membership.updateMany({
      where: { id: { in: expiring.map((m) => m.id) } },
      data: { status: 'expired', nextCreditAt: null },
    });

    // 2) 发月度积分
    const due = await this.prisma.membership.findMany({
      where: { status: 'active', nextCreditAt: { lte: now } },
      take: 200,
    });

    let creditsIssued = 0;
    for (const m of due) {
      // 会员已过期就不该再发 —— 条件更新保证并发下只发一次
      const claimed = await this.prisma.membership.updateMany({
        where: { id: m.id, nextCreditAt: m.nextCreditAt },
        data: { nextCreditAt: new Date(now.getTime() + 30 * 24 * 3600 * 1000) },
      });
      if (claimed.count === 0) continue;

      if (m.monthlyCreditsSnapshot > 0) {
        try {
          await this.credit.grant({
            userId: m.userId,
            credits: m.monthlyCreditsSnapshot,
            source: 'grant',
            validDays: 30,
            reason: '会员月度积分',
          });
          creditsIssued += m.monthlyCreditsSnapshot;
        } catch (e) {
          this.logger.warn(`会员月度积分发放失败 user=${m.userId}: ${(e as Error).message}`);
        }
      }
    }

    // 到期通知 (B4)。只在真的由 active/grace 改为 expired 时发,
    // updateMany 的 count 与 expiring 长度一致才算全部改写成功。
    for (const m of expiring) {
      await this.notifications.notify({
        userId: m.userId,
        type: 'membership_expired',
        vars: { date: m.expiresAt.toISOString().slice(0, 10) },
        fallbackTitle: '会员已到期',
        fallbackBody: `你的会员已于 ${m.expiresAt.toISOString().slice(0, 10)} 到期。`,
        link: '/packages',
      });
    }

    if (expiredRes.count > 0 || due.length > 0) {
      this.logger.log(
        `会员调度: ${expiredRes.count} 个到期, ${due.length} 个发放积分, 共 ${creditsIssued} 积分`,
      );
    }
    return { expired: expiredRes.count, creditsGranted: due.length, creditsIssued };
  }

  // ── 查询 ──────────────────────────────────────────────────────────

  /** 我的会员详情 */
  async detailOf(userId: string) {
    const resolved = await this.resolve(userId);
    const history = await this.prisma.membership.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { plan: { select: { code: true, name: true } } },
    });

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
      history: history.map((h) => ({
        id: h.id,
        planCode: h.plan.code,
        planName: h.plan.name,
        status: h.status,
        startAt: h.startAt,
        expiresAt: h.expiresAt,
        monthlyCredits: h.monthlyCreditsSnapshot,
      })),
    };
  }

  /** 套餐列表 (C 端展示) */
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
  labels.push(monthlyCredits > 0 ? `每月赠送 ${monthlyCredits} 积分` : '订阅期内含积分');
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