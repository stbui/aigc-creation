import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { CreditWalletService } from '../model/billing/credit-wallet.service';
import {
  MicrocreditError,
  formatCredits,
  parseCredits,
  toMicrocredits,
} from '../model/infra/microcredits';

/**
 * 积分账本 (admin-prd.md §3.9B-49~B-52 / §5 数据口径)。
 *
 * 三条不可动摇的约定:
 *
 * **1. 金额以微积分为唯一运算单位。** 1 积分 = 1,000,000 微积分；
 *    对外（C 端 / 后台）仍按积分展示，换算只发生在 API 边界。
 *    生成账单按微积分预留与结算，批次若停留在整积分就永远扣不平。
 *
 * **2. 余额由 `CreditAccount` 权威、`CreditLot` 批次权威共同支撑。**
 *    两者必须相等，写入统一走 `CreditWalletService` —— 任何一处绕过它
 *    直接改批次，都会在每日对账里变成查不出来源的差额。
 *
 * **3. 扣减按 FEFO (First Expire First Out)**：按 expireAt 升序逐批扣，
 *    为空视为最晚到期（钱包层已统一处理）。
 *
 * 业务侧（充值发放 / 人工调整 / 退款扣回 / 到期回收）只使用本服务；
 * 生成账单的预留与结算走 `model/billing`，不经过这里。
 */

export interface BalanceSummary {
  /** 可用余额 = 账户可用微积分折算的积分 */
  balance: number;
  /** 即将过期量: 30 天内到期的批次剩余积分 */
  expiringSoon: number;
  /** 累计获得 */
  totalEarned: number;
  /** 累计消耗 (不含退款、人工调整与到期) */
  totalConsumed: number;
  /** 有效批次数 */
  activeLots: number;
  /** 最早到期时间; null = 无批次到期 */
  nearestExpiry: string | null;
}

/** 积分（可带 6 位小数）→ 微积分；拒绝负数与超精度 */
export function creditsToMicrocredits(credits: number | string): bigint {
  try {
    const micro = parseCredits(credits);
    if (micro < 0n) throw new AppError(40001, '积分金额不能为负数', 400);
    return micro;
  } catch (error) {
    if (error instanceof MicrocreditError) throw new AppError(40001, `积分金额无效：${credits}`, 400);
    throw error;
  }
}

/** 微积分 → 积分。整数额度不产生小数尾巴，其余保留至 6 位 */
export function microcreditsToCredits(micro: bigint | number): number {
  return Number(formatCredits(toMicrocredits(micro)));
}

@Injectable()
export class CreditService {
  private readonly logger = new Logger(CreditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: CreditWalletService,
  ) {}

  // ── 查询 ──────────────────────────────────────────────────────────

  /** 余额总览 (B-49)：账户可用余额 + 批次到期信息 */
  async balanceOf(userId: string): Promise<BalanceSummary> {
    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

    const [account, lots, earnedAgg, consumedAgg] = await Promise.all([
      this.prisma.creditAccount.findUnique({ where: { userId } }),
      this.prisma.creditLot.findMany({
        where: { userId, remainingMicrocredits: { gt: 0n } },
        select: { remainingMicrocredits: true, expireAt: true },
      }),
      // 累计获得是终身口径: 已用尽 / 已过期的批次也曾到账
      this.prisma.creditLedgerEntry.aggregate({
        where: { userId, type: { in: ['purchase', 'grant', 'admin_adjust'] } },
        _sum: { amountMicrocredits: true },
      }),
      this.prisma.creditLedgerEntry.aggregate({
        where: { userId, type: 'consume' },
        _sum: { amountMicrocredits: true },
      }),
    ]);

    const valid = lots.filter((l) => !l.expireAt || l.expireAt > now);
    const expiringSoon = valid
      .filter((l) => l.expireAt && l.expireAt <= soon)
      .reduce((sum, l) => sum + l.remainingMicrocredits, 0n);
    const expiries = valid
      .map((l) => l.expireAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());

    return {
      balance: microcreditsToCredits(account?.availableMicrocredits ?? 0n),
      expiringSoon: microcreditsToCredits(expiringSoon),
      totalEarned: microcreditsToCredits(earnedAgg._sum.amountMicrocredits ?? 0n),
      // consume 流水的 amount 是负数, 取绝对值即为累计消耗
      totalConsumed: microcreditsToCredits(abs(consumedAgg._sum.amountMicrocredits ?? 0n)),
      activeLots: valid.length,
      nearestExpiry: expiries[0]?.toISOString() ?? null,
    };
  }

  /** 批次明细 (B-50) */
  async lotsOf(userId: string, includeExpired = true) {
    const lots = await this.prisma.creditLot.findMany({
      where: { userId, ...(includeExpired ? {} : { remainingMicrocredits: { gt: 0n } }) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const now = Date.now();
    return lots.map((l) => {
      const remaining = microcreditsToCredits(l.remainingMicrocredits);
      return {
        id: l.id,
        source: l.source,
        orderId: l.orderId,
        totalCredits: microcreditsToCredits(l.totalMicrocredits),
        remainingCredits: remaining,
        expireAt: l.expireAt,
        createdAt: l.createdAt,
        // 状态: active 可用 / expired 已过期 / exhausted 已用尽
        status:
          remaining <= 0
            ? 'exhausted'
            : l.expireAt && l.expireAt.getTime() <= now
              ? 'expired'
              : 'active',
      };
    });
  }

  /**
   * 流水查询 (B-51)
   *
   * 读 `CreditLedgerEntry`（微积分）并投影成积分口径。`reserve` 是任务预授权，
   * 随后会以 consume/refund 结清；C 端默认不展示中间态，由调用方按需过滤。
   */
  async ledgerOf(
    userId: string,
    limit = 50,
    options: { includeReserve?: boolean; offset?: number } = {},
  ) {
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const skip = Math.max(Number(options.offset) || 0, 0);
    const where = {
      userId,
      ...(options.includeReserve ? {} : { type: { not: 'reserve' } }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.creditLedgerEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.creditLedgerEntry.count({ where }),
    ]);
    return {
      items: rows.map(projectEntry),
      total,
      limit: take,
      offset: skip,
    };
  }

  // ── 发放 ──────────────────────────────────────────────────────────

  /**
   * 发放积分 (购买成功 / 后台发放)。
   *
   * 每次发放创建**独立批次** —— 不合并已有批次。
   * 合并会让"这笔积分什么时候过期"变得无法回答, 而退款必须按批次精确扣回。
   *
   * @param tx 可选事务客户端。会员开通等「一次性权益」场景需要把
   *           「抢占订单 + 延期会员 + 发积分」放进同一个事务。
   */
  async grant(
    params: {
      userId: string;
      credits: number;
      source: 'purchase' | 'grant' | 'admin_adjust';
      validDays?: number;
      orderId?: string;
      taskId?: string;
      /** 稳定幂等键；重复发放直接返回已有流水，不再创建新批次。 */
      idempotencyKey?: string;
      reason?: string;
      operatorId?: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ lotId: string; balance: number; idempotentHit?: boolean }> {
    const amount = creditsToMicrocredits(params.credits);
    if (amount <= 0n) throw new AppError(40001, '发放积分数必须大于 0', 400);

    // validDays=0 或未指定 → 永久有效(expireAt 为空, FEFO 排最后)
    const expireAt =
      params.validDays && params.validDays > 0
        ? new Date(Date.now() + params.validDays * 24 * 3600 * 1000)
        : null;
    const type = params.source === 'purchase' ? 'purchase' : params.source === 'grant' ? 'grant' : 'admin_adjust';
    const referenceKey = params.idempotencyKey ? `credit-grant:${params.idempotencyKey}` : null;

    const execute = async (db: Prisma.TransactionClient) => {
      if (referenceKey) {
        const existing = await db.creditLedgerEntry.findUnique({
          where: { referenceKey },
          select: { userId: true },
        });
        if (existing) {
          if (existing.userId !== params.userId) throw new AppError(40001, '积分幂等键冲突', 400);
          const balance = await this.wallet.balanceOf(db, params.userId);
          return { lotId: '', balance: microcreditsToCredits(balance.availableMicrocredits), idempotentHit: true };
        }
      }
      const result = await this.wallet.grant(db, {
        userId: params.userId,
        amountMicrocredits: amount,
        source: params.source,
        type,
        expireAt,
        orderId: params.orderId,
        meta: {
          paymentOrderId: params.orderId ?? '',
          taskId: params.taskId ?? '',
          actorUserId: params.operatorId ?? '',
          note: params.reason ?? '',
          referenceKey: referenceKey ?? undefined,
        },
      });
      return {
        lotId: result.lotId,
        balance: microcreditsToCredits(result.balance.availableMicrocredits),
        idempotentHit: false,
      };
    };

    if (tx) return execute(tx);
    return this.prisma.$transaction(execute);
  }

  // ── 扣减 ──────────────────────────────────────────────────────────

  /**
   * 扣减积分, FEFO 逐批扣。
   *
   * 用于人工扣减等非账单场景；生成任务的扣费走 `BillingService` 的预留/结算，
   * 不经过这里（否则同一笔消耗会出现两条口径不同的流水）。
   */
  async consume(
    params: {
      userId: string;
      credits: number;
      taskId?: string;
      orderId?: string;
      allowNegative?: boolean;
      /** 流水的业务类型。人工扣减必须传 `admin_adjust`。 */
      ledgerType?: 'consume' | 'admin_adjust';
      reason?: string;
      operatorId?: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ consumed: number; balance: number; lotId: string | null }> {
    const amount = creditsToMicrocredits(params.credits);
    if (params.allowNegative) {
      throw new AppError(40001, '不允许透支扣减积分', 400);
    }
    const type = params.ledgerType ?? 'consume';
    const execute = async (db: Prisma.TransactionClient) => {
      if (amount <= 0n) {
        const balance = await this.wallet.balanceOf(db, params.userId);
        return { consumed: 0, balance: microcreditsToCredits(balance.availableMicrocredits), lotId: null };
      }
      // 余额不足由钱包抛 40002；调用方按语义决定是否转成 402
      const result = await this.wallet.debit(db, {
        userId: params.userId,
        amountMicrocredits: amount,
        type,
        meta: {
          taskId: params.taskId ?? '',
          paymentOrderId: params.orderId ?? '',
          actorUserId: params.operatorId ?? '',
          note: params.reason ?? '',
        },
      });
      return {
        consumed: microcreditsToCredits(amount),
        balance: microcreditsToCredits(result.balance.availableMicrocredits),
        lotId: result.items[result.items.length - 1]?.lotId ?? null,
      };
    };
    return tx ? execute(tx) : this.prisma.$transaction(execute);
  }

  /** 余额是否足够 */
  async hasEnough(userId: string, credits: number): Promise<boolean> {
    if (credits <= 0) return true;
    const account = await this.prisma.creditAccount.findUnique({ where: { userId } });
    return (account?.availableMicrocredits ?? 0n) >= creditsToMicrocredits(credits);
  }

  // ── 人工调整 (B-52) ──────────────────────────────────────────────

  /**
   * 人工增减积分。**强制填写原因**。
   *
   * 不允许"无理由调整" —— 积分是用户的资产, 无痕改动等于资损。
   */
  async adminAdjust(params: {
    userId: string;
    delta: number;
    reason: string;
    operatorId: string;
    validDays?: number;
  }): Promise<{ balance: number }> {
    const reason = params.reason?.trim();
    if (!reason) {
      throw new AppError(40001, '人工调整积分必须填写原因', 400);
    }
    if (params.delta === 0) {
      throw new AppError(40001, '调整值不能为 0', 400);
    }

    if (params.delta > 0) {
      await this.grant({
        userId: params.userId,
        credits: params.delta,
        source: 'admin_adjust',
        validDays: params.validDays,
        reason,
        operatorId: params.operatorId,
      });
    } else {
      // 人工扣减只记一条 admin_adjust 流水；再补一条 consume 会让账本合计翻倍
      await this.consume({
        userId: params.userId,
        credits: -params.delta,
        ledgerType: 'admin_adjust',
        reason,
        operatorId: params.operatorId,
      });
    }

    const summary = await this.balanceOf(params.userId);
    this.logger.log(
      `人工调整积分: user=${params.userId} delta=${params.delta} 余额=${summary.balance} 原因="${reason}"`,
    );
    return { balance: summary.balance };
  }

  // ── 退款扣回 ──────────────────────────────────────────────────────

  /**
   * 退款扣回: 按批次剩余量逐批扣 (B-43)。
   *
   * 关键语义: **退的是"还没花掉的部分"**。
   * 用户买了 1000 积分已消耗 600, 退款只能扣回 400 ——
   * 已消耗的部分无法追回, 这部分必须如实记为 creditsUnreclaimable,
   * 否则对账会以为系统凭空丢了 600 积分。
   *
   * 按 orderId 关联的批次优先扣 —— 退款针对的就是这笔订单发的积分。
   */
  async reclaimForOrder(
    orderId: string,
    operatorId: string,
    reason: string,
  ): Promise<{ reclaimed: number; unreclaimable: number; detail: Array<{ lotId: string; taken: number }> }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true, grantedCredits: true },
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);

    const target = creditsToMicrocredits(order.grantedCredits);
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      // 优先扣该订单的批次, 其次扣用户其它批次(用户可能已把积分转移到长有效期批次)
      const lots = await tx.creditLot.findMany({
        where: {
          userId: order.userId,
          remainingMicrocredits: { gt: 0n },
          OR: [{ expireAt: null }, { expireAt: { gt: now } }],
        },
        select: { id: true, remainingMicrocredits: true, orderId: true },
        // 同订单的优先, 组内按 FEFO
        orderBy: [{ orderId: 'asc' }, { expireAt: { sort: 'asc', nulls: 'last' } }],
      });

      let toReclaim = target;
      const detail: Array<{ lotId: string; taken: number }> = [];
      let reclaimed = 0n;

      for (const lot of lots) {
        if (toReclaim <= 0n) break;
        const take = lot.remainingMicrocredits < toReclaim ? lot.remainingMicrocredits : toReclaim;
        const res = await tx.creditLot.updateMany({
          where: { id: lot.id, remainingMicrocredits: { gte: take } },
          data: { remainingMicrocredits: { decrement: take } },
        });
        if (res.count === 0) continue;
        detail.push({ lotId: lot.id, taken: microcreditsToCredits(take) });
        reclaimed += take;
        toReclaim -= take;
      }

      if (reclaimed > 0n) {
        // 批次已经逐笔扣过，这里只同步账户并写一条流水
        const balance = await this.wallet.debitAccountOnly(tx, order.userId, reclaimed);
        await tx.creditLedgerEntry.create({
          data: {
            userId: order.userId,
            type: 'refund_reclaim',
            amountMicrocredits: -reclaimed,
            availableDeltaMicrocredits: -reclaimed,
            reservedDeltaMicrocredits: 0n,
            availableAfterMicrocredits: balance.availableMicrocredits,
            reservedAfterMicrocredits: balance.reservedMicrocredits,
            paymentOrderId: orderId,
            actorUserId: operatorId,
            note: reason,
          },
        });
      }

      return { reclaimed, unreclaimable: toReclaim, detail };
    });

    if (result.unreclaimable > 0n) {
      // 这是必须让人看见的事实, 不能静默吞掉
      this.logger.warn(
        `退款扣回不完整: order=${orderId} 应扣 ${microcreditsToCredits(target)} 实扣 ${microcreditsToCredits(result.reclaimed)}，` +
          `${microcreditsToCredits(result.unreclaimable)} 因已消耗无法追回`,
      );
    }

    return {
      reclaimed: microcreditsToCredits(result.reclaimed),
      unreclaimable: microcreditsToCredits(result.unreclaimable),
      detail: result.detail,
    };
  }

  // ── 到期回收 ──────────────────────────────────────────────────────

  /**
   * 到期批次回收 (M9.5 调度器)。
   *
   * 回收后 remainingMicrocredits 归零、账户可用余额同步减少，记 expire 流水。
   * ⚠ **不删批次** —— 删了就无法回答"这笔积分原本有多少、什么时候过期的"。
   */
  async expireLots(): Promise<{ expiredLots: number; expiredCredits: number }> {
    const now = new Date();
    const due = await this.prisma.creditLot.findMany({
      where: { remainingMicrocredits: { gt: 0n }, expireAt: { lte: now } },
      select: { id: true, userId: true, remainingMicrocredits: true },
    });

    let expiredMicro = 0n;
    let expiredLots = 0;
    for (const lot of due) {
      const done = await this.prisma.$transaction((tx) => this.wallet.expireLot(tx, lot));
      if (!done) continue;
      expiredLots += 1;
      expiredMicro += lot.remainingMicrocredits;
    }

    if (expiredLots > 0) {
      this.logger.log(
        `积分到期回收: ${expiredLots} 个批次, 共 ${microcreditsToCredits(expiredMicro)} 积分`,
      );
    }
    return { expiredLots, expiredCredits: microcreditsToCredits(expiredMicro) };
  }
}

/** 流水的积分口径投影（C 端与后台共用同一份字段名） */
export function projectEntry(row: {
  id: string;
  userId: string;
  type: string;
  amountMicrocredits: bigint;
  availableAfterMicrocredits: bigint;
  paymentOrderId: string;
  billingOrderId: string;
  lotId: string;
  taskId: string;
  note: string;
  actorUserId: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    amount: microcreditsToCredits(row.amountMicrocredits),
    balanceAfter: microcreditsToCredits(row.availableAfterMicrocredits),
    lotId: row.lotId || null,
    orderId: row.paymentOrderId || row.billingOrderId || null,
    taskId: row.taskId || null,
    reason: row.note || null,
    operatorId: row.actorUserId || null,
    createdAt: row.createdAt,
  };
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}
