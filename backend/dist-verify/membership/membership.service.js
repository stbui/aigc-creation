"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var MembershipService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MembershipService = exports.DEFAULT_PERKS = void 0;
exports.parsePerks = parsePerks;
exports.applyDiscount = applyDiscount;
exports.buildPerkLabels = buildPerkLabels;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const app_exception_1 = require("../common/app.exception");
const credit_service_1 = require("../credits/credit.service");
const notifications_service_1 = require("../notifications/notifications.service");
/** 非会员 / 系统异常时的兜底权益。
 *
 * 这些值**必须等于"什么都不给"**, 任何一项被调高都会让免费用户拿到会员待遇。
 */
exports.DEFAULT_PERKS = {
    fastChannel: false,
    maxConcurrent: 0,
    addonDiscountBps: 10000,
};
/** perks JSON 的解析与校验。
 *
 * JSON 单字段没有 DB 层校验, 所以解析必须严格:
 * 宁可用默认值, 也不能让脏数据把 maxConcurrent 变成 "abc" 后参与比较。
 */
function parsePerks(raw, fallback = exports.DEFAULT_PERKS) {
    if (!raw)
        return { ...fallback };
    let obj;
    try {
        obj = JSON.parse(raw);
    }
    catch {
        // 快照损坏时退回兜底而不是抛错 —— 权益不该让主链路挂掉
        return { ...fallback };
    }
    if (!obj || typeof obj !== 'object')
        return { ...fallback };
    const o = obj;
    const num = (v, def) => {
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
function applyDiscount(cents, bps) {
    if (bps >= 10000 || cents <= 0)
        return cents;
    return Math.max(0, Math.round((cents * bps) / 10000));
}
let MembershipService = MembershipService_1 = class MembershipService {
    constructor(prisma, credit, notifications) {
        this.prisma = prisma;
        this.credit = credit;
        this.notifications = notifications;
        this.logger = new common_1.Logger(MembershipService_1.name);
    }
    /**
     * 解析用户当前权益。
     *
     * **永不抛错** —— 查会员失败时返回 DEFAULT_PERKS。
     * 会员是增值项, 数据库抖动不该让用户无法下单。
     */
    async resolve(userId) {
        const NON_MEMBER = {
            isMember: false,
            planCode: 'free',
            planName: '普通用户',
            perks: { ...exports.DEFAULT_PERKS },
            expiresAt: null,
            monthlyCredits: 0,
            cancelAtPeriodEnd: false,
        };
        if (!userId)
            return NON_MEMBER;
        try {
            const m = await this.prisma.membership.findFirst({
                where: {
                    userId,
                    // cancelled 表示已取消自动续费, 但用户已付的周期不能被立刻收回。
                    status: { in: ['active', 'grace', 'cancelled'] },
                    expiresAt: { gt: new Date() },
                },
                include: { plan: { select: { code: true, name: true } } },
                orderBy: { expiresAt: 'desc' },
            });
            if (!m)
                return NON_MEMBER;
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
        }
        catch (e) {
            this.logger.warn(`解析会员权益失败, 按非会员处理: ${e.message}`);
            return NON_MEMBER;
        }
    }
    /** 仅取权益 (热路径用, 避免每次都带 plan) */
    async perksOf(userId) {
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
    async checkConcurrency(userId) {
        const { perks } = await this.resolve(userId);
        if (perks.maxConcurrent <= 0) {
            // 不限 —— 仍返回当前数供 UI 展示
            const current = await this.countActive(userId);
            return { current, limit: 0 };
        }
        const current = await this.countActive(userId);
        if (current >= perks.maxConcurrent) {
            throw new app_exception_1.AppError(40003, `已达会员并发上限 (${perks.maxConcurrent} 个任务进行中),请等待完成或升级会员`, 400);
        }
        return { current, limit: perks.maxConcurrent };
    }
    async countActive(userId) {
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
    async quoteOrder(userId, originalCents, opts) {
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
    async recordUsage(userId, orderId, savedCents, planCode) {
        if (savedCents <= 0)
            return;
        await this.prisma.membershipUsage
            .create({ data: { userId, orderId, savedCents, planCode } })
            .catch((e) => {
            // 优惠记录失败不影响订单本身
            this.logger.warn(`记录会员优惠失败: ${e.message}`);
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
    async subscribe(params) {
        const order = await this.prisma.order.findUnique({
            where: { id: params.orderId },
            select: { id: true, userId: true, status: true, membershipPlanId: true, orderNo: true },
        });
        if (!order)
            throw new app_exception_1.AppError(40400, '订单不存在', 404);
        if (order.userId !== params.userId) {
            throw new app_exception_1.AppError(40301, '无权使用该订单', 403);
        }
        if (order.status !== 'paid') {
            throw new app_exception_1.AppError(40901, '订单未支付, 不能开通会员', 409);
        }
        if (order.membershipPlanId !== params.planId) {
            throw new app_exception_1.AppError(40001, '订单与会员套餐不匹配', 400);
        }
        const plan = await this.prisma.membershipPlan.findUnique({ where: { id: params.planId } });
        if (!plan)
            throw new app_exception_1.AppError(40400, '会员套餐不存在', 404);
        /*
         * ⚠ 这里**不校验 plan.status** —— 用户付款时套餐是可售的, 之后运营下架
         * 不该让已付款的订单永远开通不了。"是否可购买"是下单时的判定 (OrderService.create)。
         */
        if (plan.durationDays <= 0) {
            throw new app_exception_1.AppError(40001, '默认套餐不支持购买', 400);
        }
        const result = await this.prisma.$transaction(async (tx) => {
            // 一次性闸门: 只有闸门从 null 变成时间戳的那次调用能继续往下走
            const claim = await tx.order.updateMany({
                where: { id: order.id, status: 'paid', membershipAppliedAt: null },
                data: { membershipAppliedAt: new Date() },
            });
            if (claim.count === 0)
                return { claimed: false };
            const now = new Date();
            const current = await tx.membership.findFirst({
                // 已取消但尚未到期的会员仍可续费: 新订单会把它重新激活并顺延到期时间。
                where: { userId: params.userId, status: { in: ['active', 'grace', 'cancelled'] } },
                orderBy: { expiresAt: 'desc' },
            });
            // 从当前到期时间顺延, 已过期则从现在开始
            const base = current && current.expiresAt > now ? current.expiresAt : now;
            const expiresAt = new Date(base.getTime() + plan.durationDays * 24 * 3600 * 1000);
            const perksSnapshot = JSON.stringify(parsePerks(plan.perks));
            const nextCreditAt = new Date(Math.min(expiresAt.getTime(), now.getTime() + plan.durationDays * 24 * 3600 * 1000));
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
                await this.credit.grant({
                    userId: params.userId,
                    credits: plan.monthlyCredits,
                    source: 'grant',
                    // 会员积分与订阅同周期到期
                    validDays: plan.durationDays,
                    orderId: params.orderId,
                    reason: `会员订阅积分 (${plan.name})`,
                }, tx);
                // 下期发放时间 = 一个月后
                await tx.membership.update({
                    where: { id: membership.id },
                    data: { nextCreditAt: new Date(now.getTime() + 30 * 24 * 3600 * 1000) },
                });
            }
            return { claimed: true, membershipId: membership.id, expiresAt };
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
        this.logger.log(`会员开通/续期: user=${params.userId} plan=${plan.code} 到期=${result.expiresAt.toISOString()} order=${order.orderNo}`);
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
    async cancel(userId) {
        const m = await this.prisma.membership.findFirst({
            // cancelled 也要能查到: 重复点「取消续费」应幂等返回同一到期时间,
            // 而不是报「没有生效中的会员」让用户以为第一次没生效。
            where: { userId, status: { in: ['active', 'grace', 'cancelled'] }, expiresAt: { gt: new Date() } },
            orderBy: { expiresAt: 'desc' },
        });
        if (!m)
            throw new app_exception_1.AppError(40400, '没有生效中的会员', 404);
        // 已经取消过: 不再改状态, 直接回同一到期时间
        if (m.status === 'cancelled') {
            return { expiresAt: m.expiresAt.toISOString() };
        }
        /*
         * 已付周期保留到 `expiresAt`，只停止自动续费。
         *
         * 旧实现把状态置 cancelled 后 `resolve()` 又只认 active/grace，导致用户
         * 刚点完取消就立刻失去会员 —— 与确认框承诺的「权益保留至到期日」不符。
         * 现在 resolve() 也接受 cancelled，到期由调度任务统一失效。
         */
        const updated = await this.prisma.membership.update({
            where: { id: m.id },
            data: {
                // 查询已限定 expiresAt > now，所以这里一定是「未到期」的取消
                status: 'cancelled',
                nextCreditAt: null,
            },
        });
        // expiresAt 保持不变: cancelled 在到期前仍算会员, 只是不再自动续费
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
    async runSchedulerTasks() {
        const now = new Date();
        // 1) 到期转expired
        //    先查出到期的是哪些人, 再条件更新: 通知需要一个 userId, 而 updateMany
        //    只回 count。条件里带上 status/expiresAt 保证并发下不会重复通知。
        const expiring = await this.prisma.membership.findMany({
            // cancelled 也要在周期结束时真正失效, 否则会永远保留权益。
            where: { status: { in: ['active', 'grace', 'cancelled'] }, expiresAt: { lte: now } },
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
            if (claimed.count === 0)
                continue;
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
                }
                catch (e) {
                    this.logger.warn(`会员月度积分发放失败 user=${m.userId}: ${e.message}`);
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
            this.logger.log(`会员调度: ${expiredRes.count} 个到期, ${due.length} 个发放积分, 共 ${creditsIssued} 积分`);
        }
        return { expired: expiredRes.count, creditsGranted: due.length, creditsIssued };
    }
    // ── 查询 ──────────────────────────────────────────────────────────
    /** 我的会员详情 */
    async detailOf(userId) {
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
    /**
     * 单个套餐（含已下架）。
     *
     * 只用于「续付既有会员订单」：订单已经按套餐快照创建，套餐后来下架
     * 不应让 pending 订单永久无法支付。公开列表仍只返回 active。
     */
    async planById(planId) {
        const p = await this.prisma.membershipPlan.findUnique({ where: { id: planId } });
        if (!p)
            return null;
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
};
exports.MembershipService = MembershipService;
exports.MembershipService = MembershipService = MembershipService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        credit_service_1.CreditService,
        notifications_service_1.NotificationsService])
], MembershipService);
/** 权益 → 用户能看懂的话。
 *
 * 由后端生成而非前端拼: 权益定义在后端, 文案理应跟着定义走,
 * 否则改权益时前端文案会漏改, 变成"宣传页写的和实际不一样"。
 */
function buildPerkLabels(perks, monthlyCredits = 0) {
    const labels = [];
    // 0 配额不发积分 —— 免费档写「订阅期内含积分」是假话, 直接不出这条
    if (monthlyCredits > 0)
        labels.push(`每月赠送 ${monthlyCredits} 积分`);
    if (perks.fastChannel)
        labels.push('专享快速生成通道');
    if (perks.maxConcurrent > 0)
        labels.push(`同时处理 ${perks.maxConcurrent} 个任务`);
    else
        labels.push('不限并发任务数');
    if (perks.addonDiscountBps < 10000) {
        const zhe = (perks.addonDiscountBps / 1000).toFixed(2).replace(/\.?0+$/, '');
        labels.push(`加油包${zhe} 折`);
    }
    else {
        labels.push('加油包无折扣');
    }
    return labels.filter(Boolean);
}
//# sourceMappingURL=membership.service.js.map