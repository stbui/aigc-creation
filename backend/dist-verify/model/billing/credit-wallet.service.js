"use strict";
/**
 * 微积分钱包 —— 账户余额与批次扣减的唯一写入口。
 *
 * 两条余额必须同时维护且始终满足 `CreditAccount.availableMicrocredits == Σ CreditLot.remainingMicrocredits`：
 *   · `CreditAccount` 是用户级权威（可用 / 预留 / 版本号），生成账单的预留与结算只改它；
 *   · `CreditLot` 是批次权威，决定「这笔积分什么时候过期」，FEFO 从它扣减。
 * 只改其一就会在每日对账里出现差额 —— 而差额一旦出现，就无法判断是漏扣还是漏退。
 *
 * 所有方法都要求调用方传入事务客户端：账单状态与资金变动必须在同一个事务里落库，
 * 否则「账单已退款、积分没退」这类半成品状态没有任何自动恢复路径。
 *
 * 移植自 open-ai-canvas `repository/finance_billing.go` 的账户模型 + 本仓设计文档 §6.3
 * 的批次规则（参考实现没有批次维度，本仓需要保留到期语义）。
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreditWalletService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const app_exception_1 = require("../../common/app.exception");
let CreditWalletService = class CreditWalletService {
    /** 账户不存在时补建；并发补建以唯一键冲突为准，重读即可 */
    async ensureAccount(db, userId) {
        const id = String(userId ?? '').trim();
        if (!id)
            throw new app_exception_1.AppError(40001, '用户不存在', 400);
        const existing = await db.creditAccount.findUnique({ where: { userId: id }, select: { userId: true } });
        if (existing)
            return;
        try {
            await db.creditAccount.create({ data: { userId: id } });
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
                return;
            throw error;
        }
    }
    /** 读取账户余额；不存在返回 0/0（只读场景不补建） */
    async balanceOf(db, userId) {
        const row = await db.creditAccount.findUnique({ where: { userId } });
        return {
            availableMicrocredits: row?.availableMicrocredits ?? 0n,
            reservedMicrocredits: row?.reservedMicrocredits ?? 0n,
        };
    }
    /**
     * 发放：新建独立批次并增加可用余额。
     * 不合并已有批次 —— 合并不了「这笔积分何时过期」，退款也无法按批次精确扣回。
     */
    async grant(db, params) {
        const amount = params.amountMicrocredits;
        if (amount <= 0n)
            throw new app_exception_1.AppError(40001, '发放积分数必须大于 0', 400);
        await this.ensureAccount(db, params.userId);
        const lot = await db.creditLot.create({
            data: {
                userId: params.userId,
                source: params.source,
                orderId: params.orderId,
                totalMicrocredits: amount,
                remainingMicrocredits: amount,
                expireAt: params.expireAt ?? null,
            },
        });
        const account = await db.creditAccount.update({
            where: { userId: params.userId },
            data: { availableMicrocredits: { increment: amount }, version: { increment: 1 } },
        });
        await this.writeEntry(db, params.userId, params.type, amount, amount, 0n, account, {
            ...params.meta,
            lotId: lot.id,
            paymentOrderId: params.meta?.paymentOrderId ?? params.orderId ?? '',
        });
        return { lotId: lot.id, balance: snapshot(account) };
    }
    /**
     * 扣减（非预留）：FEFO 逐批扣，同时减可用余额。
     *
     * 每批次用条件更新 `remaining >= take`，并发下影响 0 行就换下一批 ——
     * 先读后写在迁移到 PostgreSQL 后会丢更新。
     */
    async debit(db, params) {
        const amount = params.amountMicrocredits;
        if (amount <= 0n)
            return { balance: await this.balanceOf(db, params.userId), items: [] };
        await this.ensureAccount(db, params.userId);
        const account = await db.creditAccount.updateMany({
            where: { userId: params.userId, availableMicrocredits: { gte: amount } },
            data: { availableMicrocredits: { decrement: amount }, version: { increment: 1 } },
        });
        if (account.count === 0) {
            const current = await this.balanceOf(db, params.userId);
            throw new app_exception_1.AppError(40002, `积分不足: 需要 ${formatAmount(amount)} 积分, 可用 ${formatAmount(current.availableMicrocredits)} 积分`, 400);
        }
        const items = await this.takeFromLots(db, params.userId, amount, null);
        if (items.length === 0 && amount > 0n) {
            throw new app_exception_1.AppError(50001, '账户余额与积分批次不一致，请联系管理员对账', 500);
        }
        const after = await this.balanceOf(db, params.userId);
        await this.writeEntry(db, params.userId, params.type, -amount, -amount, 0n, after, params.meta);
        return { balance: after, items };
    }
    /**
     * 只改账户可用余额（批次已由调用方逐笔扣减）。
     *
     * 唯一用途是「退款扣回」：扣回要按订单批次优先，顺序由业务决定，
     * 不能套用钱包的统一 FEFO。余额不足说明批次与账户已不一致，必须显式失败。
     */
    async debitAccountOnly(db, userId, amountMicrocredits) {
        if (amountMicrocredits <= 0n)
            return this.balanceOf(db, userId);
        await this.ensureAccount(db, userId);
        const updated = await db.creditAccount.updateMany({
            where: { userId, availableMicrocredits: { gte: amountMicrocredits } },
            data: { availableMicrocredits: { decrement: amountMicrocredits }, version: { increment: 1 } },
        });
        if (updated.count === 0) {
            throw new app_exception_1.AppError(50001, '账户余额与积分批次不一致，退款扣回失败', 500);
        }
        return this.balanceOf(db, userId);
    }
    /**
     * 预留：账户可用 → 冻结，批次按 FEFO 扣减并记录明细。
     *
     * 订单创建与预留必须在同一事务：先建单后预留失败会留下一张永远不会结算的账单。
     */
    async reserve(db, params) {
        const amount = params.amountMicrocredits;
        if (amount <= 0n)
            return { items: [], balance: await this.balanceOf(db, params.userId) };
        await this.ensureAccount(db, params.userId);
        const account = await db.creditAccount.updateMany({
            where: { userId: params.userId, availableMicrocredits: { gte: amount } },
            data: {
                availableMicrocredits: { decrement: amount },
                reservedMicrocredits: { increment: amount },
                version: { increment: 1 },
            },
        });
        if (account.count === 0) {
            const current = await this.balanceOf(db, params.userId);
            throw new app_exception_1.AppError(40002, `积分不足: 需要 ${formatAmount(amount)} 积分, 可用 ${formatAmount(current.availableMicrocredits)} 积分`, 400);
        }
        const items = await this.takeFromLots(db, params.userId, amount, params.billingOrderId);
        if (items.length === 0) {
            throw new app_exception_1.AppError(50001, '账户余额与积分批次不一致，无法完成预授权', 500);
        }
        const after = await this.balanceOf(db, params.userId);
        await this.writeEntry(db, params.userId, 'reserve', -amount, -amount, amount, after, {
            ...params.meta,
            billingOrderId: params.billingOrderId,
        });
        return { items, balance: after };
    }
    /**
     * 结算：消费预留，差额退回原批次。
     *
     * @param actualMicrocredits 实际应扣金额，必须 ≤ 预留 + 可补扣的可用余额
     * @returns refund：退回可用余额的部分；supplement：从可用余额补扣的部分
     */
    async settle(db, params) {
        const reserved = params.reservedMicrocredits;
        const actual = params.actualMicrocredits;
        if (reserved < 0n || actual < 0n)
            throw new app_exception_1.AppError(50001, '结算金额无效', 500);
        const refund = reserved > actual ? reserved - actual : 0n;
        const supplement = actual > reserved ? actual - reserved : 0n;
        const updated = await db.creditAccount.updateMany({
            where: {
                userId: params.userId,
                reservedMicrocredits: { gte: reserved },
                availableMicrocredits: { gte: supplement },
            },
            data: {
                availableMicrocredits: { increment: refund - supplement },
                reservedMicrocredits: { decrement: reserved },
                version: { increment: 1 },
            },
        });
        if (updated.count === 0) {
            throw new app_exception_1.AppError(40909, '预留积分不足以完成结算，已转人工核对', 409);
        }
        if (refund > 0n)
            await this.restoreToLots(db, params.billingOrderId, refund);
        /*
         * 补扣必须同时从批次扣减：账户可用减少而批次不动，
         * 「available == Σ remaining」立刻破掉，之后的每日对账再也对不上。
         * 补扣不是预授权，故不写 CreditReservationItem —— 那会让「按明细退款」
         * 把补扣的部分也退回去。
         */
        if (supplement > 0n)
            await this.takeFromLots(db, params.userId, supplement, null);
        const after = await this.balanceOf(db, params.userId);
        await this.writeEntry(db, params.userId, 'consume', -actual, -supplement, -reserved, after, {
            ...params.meta,
            billingOrderId: params.billingOrderId,
            note: params.note ?? '',
        });
        if (refund > 0n) {
            await this.writeEntry(db, params.userId, 'refund', refund, refund, 0n, after, {
                ...params.meta,
                billingOrderId: params.billingOrderId,
                note: params.note ? `${params.note}；预授权差额退回` : '预授权差额退回',
            });
        }
        return { refund, supplement, balance: after };
    }
    /** 退款：冻结金额全额退回可用余额，批次明细原路回填 */
    async refund(db, params) {
        const amount = params.amountMicrocredits;
        if (amount <= 0n)
            return { balance: await this.balanceOf(db, params.userId) };
        const updated = await db.creditAccount.updateMany({
            where: { userId: params.userId, reservedMicrocredits: { gte: amount } },
            data: {
                availableMicrocredits: { increment: amount },
                reservedMicrocredits: { decrement: amount },
                version: { increment: 1 },
            },
        });
        if (updated.count === 0) {
            throw new app_exception_1.AppError(40909, '预留积分与账单不一致，已转人工核对', 409);
        }
        await this.restoreToLots(db, params.billingOrderId, amount);
        const after = await this.balanceOf(db, params.userId);
        await this.writeEntry(db, params.userId, 'refund', amount, amount, -amount, after, {
            ...params.meta,
            billingOrderId: params.billingOrderId,
            note: params.note ?? '',
        });
        return { balance: after };
    }
    /** 到期回收：批次剩余清零，可用余额同步减少，写 expire 流水 */
    async expireLot(db, lot) {
        const amount = lot.remainingMicrocredits;
        if (amount <= 0n)
            return false;
        const zeroed = await db.creditLot.updateMany({
            where: { id: lot.id, remainingMicrocredits: { gt: 0n } },
            data: { remainingMicrocredits: 0n },
        });
        if (zeroed.count === 0)
            return false;
        await this.ensureAccount(db, lot.userId);
        /*
         * CAS 条件 `available >= amount` 不可省：到期回收与生成任务的 reserve
         * 是两条并发写路径，先读后写会让 available 被减成负数 ——
         * 那一刻 `available == Σ remaining` 就破了，且之后任何扣费都会以
         * 「账户余额与批次不一致」失败收场。
         *
         * 扣不动说明批次与账户已经不一致，抛错让整个事务回滚（批次清零也一并
         * 撤销），把这一批留给人工对账，而不是把账户写坏。
         */
        const debited = await db.creditAccount.updateMany({
            where: { userId: lot.userId, availableMicrocredits: { gte: amount } },
            data: { availableMicrocredits: { decrement: amount }, version: { increment: 1 } },
        });
        if (debited.count === 0) {
            throw new app_exception_1.AppError(50001, '账户可用余额低于批次剩余，到期回收已中止，请联系管理员对账', 500);
        }
        const after = await this.balanceOf(db, lot.userId);
        await this.writeEntry(db, lot.userId, 'expire', -amount, -amount, 0n, after, {
            lotId: lot.id,
            note: '积分到期回收',
        });
        return true;
    }
    /** 账单的预留明细 */
    async reservationItems(db, billingOrderId) {
        const rows = await db.creditReservationItem.findMany({ where: { billingOrderId } });
        return rows.map((row) => ({ lotId: row.lotId, microcredits: row.microcredits }));
    }
    // ── 内部 ─────────────────────────────────────────────────────────
    /**
     * FEFO 从批次扣减并记录明细（有账单时）。
     *
     * 只取未过期、有剩余的批次；`expireAt` 为空视为最晚到期，排序时排最后。
     * 扣不足时抛错由调用方回滚 —— 账户余额已经先扣了，两处必须同生共死。
     */
    async takeFromLots(db, userId, amount, billingOrderId) {
        const now = new Date();
        const lots = await db.creditLot.findMany({
            where: {
                userId,
                remainingMicrocredits: { gt: 0n },
                OR: [{ expireAt: null }, { expireAt: { gt: now } }],
            },
            select: { id: true, remainingMicrocredits: true },
            orderBy: { expireAt: { sort: 'asc', nulls: 'last' } },
        });
        const items = [];
        let remaining = amount;
        for (const lot of lots) {
            if (remaining <= 0n)
                break;
            const take = lot.remainingMicrocredits < remaining ? lot.remainingMicrocredits : remaining;
            const res = await db.creditLot.updateMany({
                where: { id: lot.id, remainingMicrocredits: { gte: take } },
                data: { remainingMicrocredits: { decrement: take } },
            });
            if (res.count === 0)
                continue;
            items.push({ lotId: lot.id, microcredits: take });
            remaining -= take;
            if (billingOrderId) {
                await db.creditReservationItem.create({
                    data: { billingOrderId, lotId: lot.id, microcredits: take },
                });
            }
        }
        if (remaining > 0n) {
            throw new app_exception_1.AppError(50001, '账户余额与积分批次不一致，无法完成扣减', 500);
        }
        return items;
    }
    /**
     * 把金额退回原批次（结算差额 / 全额退款）。
     *
     * 到期时间保留：退款不是新发积分，不能借退款把快过期的积分续成永久的。
     * 若批次已在任务执行期间过期，余额会落到已过期批次上，由下一次到期回收统一清零 ——
     * 这与「过期即作废」的规则一致，且不会让账户与批次产生差额。
     */
    async restoreToLots(db, billingOrderId, amount) {
        if (amount <= 0n)
            return;
        const items = await this.reservationItems(db, billingOrderId);
        let remaining = amount;
        for (const item of items.sort((a, b) => (a.lotId < b.lotId ? -1 : a.lotId > b.lotId ? 1 : 0))) {
            if (remaining <= 0n)
                break;
            const take = item.microcredits < remaining ? item.microcredits : remaining;
            await db.creditLot.updateMany({
                where: { id: item.lotId },
                data: { remainingMicrocredits: { increment: take } },
            });
            remaining -= take;
        }
        if (remaining > 0n) {
            throw new app_exception_1.AppError(50001, '退款金额超过预留明细，已转人工核对', 500);
        }
    }
    /** 写一条流水；快照取账户当前值，调用方必须先完成账户更新 */
    async writeEntry(db, userId, type, amountMicrocredits, availableDeltaMicrocredits, reservedDeltaMicrocredits, account, meta = {}) {
        await db.creditLedgerEntry.create({
            data: {
                userId,
                type,
                amountMicrocredits,
                availableDeltaMicrocredits,
                reservedDeltaMicrocredits,
                availableAfterMicrocredits: account.availableMicrocredits,
                reservedAfterMicrocredits: account.reservedMicrocredits,
                billingOrderId: meta.billingOrderId ?? '',
                paymentOrderId: meta.paymentOrderId ?? '',
                lotId: meta.lotId ?? '',
                taskId: meta.taskId ?? '',
                actorUserId: meta.actorUserId ?? '',
                model: meta.model ?? '',
                channelId: meta.channelId ?? '',
                scene: meta.scene ?? '',
                note: meta.note ?? '',
                referenceKey: meta.referenceKey ?? null,
            },
        });
    }
};
exports.CreditWalletService = CreditWalletService;
exports.CreditWalletService = CreditWalletService = __decorate([
    (0, common_1.Injectable)()
], CreditWalletService);
function snapshot(account) {
    return {
        availableMicrocredits: account.availableMicrocredits,
        reservedMicrocredits: account.reservedMicrocredits,
    };
}
/** 错误消息里的积分展示：整数微积分不显示小数尾巴 */
function formatAmount(micro) {
    const whole = micro / 1000000n;
    const fraction = micro % 1000000n;
    if (fraction === 0n)
        return whole.toString();
    return `${whole}.${fraction.toString().padStart(6, '0').replace(/0+$/, '')}`;
}
//# sourceMappingURL=credit-wallet.service.js.map