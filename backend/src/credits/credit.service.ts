import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';

/**
 * 积分账本 (admin-prd.md §3.9B-49~B-52 / §5 数据口径)。
 *
 * 三条不可动摇的约定:
 *
 * **1. 余额唯一由 CreditLot 汇总推导, 不存冗余余额字段。**
 *    冗余余额必然与批次不一致 —— 任何一次扣减失败、任何一次并发竞争都会留下偏差,
 *    而对账时根本无从判断该信哪个。冗余余额是负债, 不是优化。
 *
 * **2. 扣减按FEFO (First Expire First Out)**: 按 expireAt 升序逐批扣,
 *    为空视为最晚到期。Prisma 的 orderBy 对 null 的排序在 SQLite 与 PostgreSQL
 *    上不一致, 所以这里用 `sortByExpiryRaw` 显式指定 SQL。
 *
 * **3. 金额一律整数, 积分同理。** 浮点会在累加时产生分位误差。
 */

export interface BalanceSummary {
  /** 可用余额 = Σ未过期批次的 remainingCredits */
  balance: number;
  /** 即将过期量: 30 天内到期的批次剩余积分 */
  expiringSoon: number;
  /** 累计获得 */
  totalEarned: number;
  /** 累计消耗 (不含退款回收与到期) */
  totalConsumed: number;
  /** 有效批次数 */
  activeLots: number;
  /** 最早到期时间; null = 无批次到期 */
  nearestExpiry: string | null;
}

@Injectable()
export class CreditService {
  private readonly logger = new Logger(CreditService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── 查询 ──────────────────────────────────────────────────────────

  /**
   * 余额总览 (B-49)。
   *
   * 全部由 CreditLot 聚合得出, 不读任何冗余字段。
   */
  async balanceOf(userId: string): Promise<BalanceSummary> {
    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

    const [lots, earnedAgg] = await Promise.all([
      this.prisma.creditLot.findMany({
        where: { userId, remainingCredits: { gt: 0 } },
        select: { remainingCredits: true, expireAt: true },
      }),
      // 累计获得是终身口径: 已用尽 / 已过期的批次也曾到账。只汇总
      // remainingCredits > 0 的批次会让「累计获得 - 累计消耗」小于余额，
      // 用户拿三个数字一对就以为账错了。
      this.prisma.creditLot.aggregate({
        where: { userId },
        _sum: { totalCredits: true },
      }),
    ]);

    // 已过期批次不计入余额 —— 但不删记录, 保留供对账追溯
    const valid = lots.filter((l) => !l.expireAt || l.expireAt > now);

    const balance = valid.reduce((sum, l) => sum + l.remainingCredits, 0);
    const totalEarned = earnedAgg._sum.totalCredits ?? 0;
    const expiringSoon = valid
      .filter((l) => l.expireAt && l.expireAt <= soon)
      .reduce((sum, l) => sum + l.remainingCredits, 0);

    const consumedAgg = await this.prisma.creditLedger.aggregate({
      where: { userId, type: 'consume' },
      _sum: { amount: true },
    });

    const expiries = valid
      .map((l) => l.expireAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());

    return {
      balance,
      expiringSoon,
      totalEarned,
      // consume 流水的 amount 是负数, 取绝对值即为累计消耗
      totalConsumed: Math.abs(consumedAgg._sum.amount ?? 0),
      activeLots: valid.length,
      nearestExpiry: expiries[0]?.toISOString() ?? null,
    };
  }

  /** 批次明细 (B-50) */
  async lotsOf(userId: string, includeExpired = true) {
    const lots = await this.prisma.creditLot.findMany({
      where: { userId, ...(includeExpired ? {} : { remainingCredits: { gt: 0 } }) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const now = Date.now();
    return lots.map((l) => ({
      id: l.id,
      source: l.source,
      orderId: l.orderId,
      totalCredits: l.totalCredits,
      remainingCredits: l.remainingCredits,
      expireAt: l.expireAt,
      createdAt: l.createdAt,
      // 状态: active 可用 / expired 已过期 / exhausted 已用尽
      status:
        l.remainingCredits <= 0
          ? 'exhausted'
          : l.expireAt && l.expireAt.getTime() <= now
            ? 'expired'
            : 'active',
    }));
  }

  /** 流水查询 (B-51) */
  async ledgerOf(userId: string, limit = 50) {
    return this.prisma.creditLedger.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { lot: { select: { source: true, expireAt: true } } },
    });
  }

  // ── 发放 ──────────────────────────────────────────────────────────

  /**
   * 发放积分 (购买成功 / 后台发放)。
   *
   * 每次发放创建**独立批次** —— 不合并已有批次。
   * 合并会让"这笔积分什么时候过期"变得无法回答, 而退款必须按批次精确扣回。
   *
   * @param tx 可选事务客户端。会员开通等「一次性权益」场景需要把
   *           「抢占订单 + 延期会员 + 发积分」放进同一个事务, 否则中途失败会
   *           留下"会员已延期但积分没发"或重试后"积分发两遍"的半成品状态。
   *           给了 tx 就在该事务内读写, 不另开连接。
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
    const { userId, credits, source } = params;
    if (credits <= 0) throw new AppError(40001, '发放积分数必须大于 0', 400);

    // validDays=0 或未指定 → 永久有效(expireAt 为空, FEFO 排最后)
    const expireAt =
      params.validDays && params.validDays > 0
        ? new Date(Date.now() + params.validDays * 24 * 3600 * 1000)
        : null;

    const execute = async (db: any) => {
      if (params.idempotencyKey) {
        const existing = await db.creditLedger.findUnique({
          where: { idempotencyKey: params.idempotencyKey },
          select: { userId: true, lotId: true },
        });
        if (existing) {
          if (existing.userId !== userId) {
            throw new AppError(40001, '积分幂等键冲突', 400);
          }
          return {
            lotId: existing.lotId ?? '',
            balance: await this.balanceWithin(db, userId),
            idempotentHit: true,
          };
        }
      }

      const lot = await db.creditLot.create({
        data: {
          userId,
          source,
          orderId: params.orderId,
          totalCredits: credits,
          remainingCredits: credits,
          expireAt,
        },
      });

      // 始终用当前事务客户端计算余额：事务外另开连接既读不到未提交行，
      // 也可能在 SQLite 上等待写锁。
      const balance = await this.balanceWithin(db, userId);
      await db.creditLedger.create({
        data: {
          userId,
          type: source === 'purchase' ? 'purchase' : source === 'grant' ? 'grant' : 'admin_adjust',
          amount: credits,
          // balanceAfter 是**快照**, 仅供流水展示与快速核对;
          // 余额永远从 CreditLot 推导, 两者不一致时以批次为准
          balanceAfter: balance,
          lotId: lot.id,
          orderId: params.orderId,
          taskId: params.taskId,
          idempotencyKey: params.idempotencyKey,
          reason: params.reason,
          operatorId: params.operatorId,
        },
      });

      return { lotId: lot.id, balance, idempotentHit: false };
    };

    if (tx) return execute(tx);

    try {
      return await this.prisma.$transaction(execute);
    } catch (error) {
      /*
       * 并发重试会在唯一键上撞车。此时整个事务已回滚（不会留下无流水的批次），
       * 再读一次既有流水即可返回同一结果。只有幂等键明确时才走该分支。
       */
      if (
        params.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.creditLedger.findUnique({
          where: { idempotencyKey: params.idempotencyKey },
          select: { userId: true, lotId: true },
        });
        if (existing && existing.userId === userId) {
          return {
            lotId: existing.lotId ?? '',
            balance: (await this.balanceOf(userId)).balance,
            idempotentHit: true,
          };
        }
      }
      throw error;
    }
  }

  /** 与 balanceOf 同口径的余额计算, 但在给定客户端(通常是事务)内执行 */
  private async balanceWithin(db: any, userId: string): Promise<number> {
    const lots = await db.creditLot.findMany({
      where: { userId, remainingCredits: { gt: 0 } },
      select: { remainingCredits: true, expireAt: true },
    });
    const now = new Date();
    return lots.reduce(
      (sum: number, l: any) => sum + (!l.expireAt || l.expireAt > now ? l.remainingCredits : 0),
      0,
    );
  }

  // ── 扣减 ──────────────────────────────────────────────────────────

  /**
   * 扣减积分, FEFO 逐批扣。
   *
   * ⚠ **并发安全**: 每批次用条件更新 `remaining >= n` 而非"读后写"。
   * SQLite 单写者已串行化, 但这段逻辑在迁到 PostgreSQL 后仍需成立 ——
   * 先读后写会丢失更新 (lost update), 两个并发请求都读到 100, 各扣 80, 余额成 -60。
   *
   * 扣减与流水在**同一事务**内: 只扣了批次没记流水等于凭空消失积分, 对账时无法解释。
   */
  async consume(params: {
    userId: string;
    credits: number;
    taskId?: string;
    orderId?: string;
    /** 允许透支时为 true (如新用户赠送)。默认 false */
    allowNegative?: boolean;
    /**
     * 流水的业务类型。人工扣减必须传 `admin_adjust` —— 否则账本上会出现一条
     * 没有原因的「生成消耗」，与真实任务消耗混在一起无法对账。
     */
    ledgerType?: 'consume' | 'admin_adjust';
    /** 写进流水的说明（人工调整必填） */
    reason?: string;
    operatorId?: string;
  }, tx?: Prisma.TransactionClient): Promise<{ consumed: number; balance: number; lotId: string | null }> {
    const { userId, credits } = params;
    if (credits <= 0) return { consumed: 0, balance: (await this.balanceOf(userId)).balance, lotId: null };

    const now = new Date();

    const execute = async (db: Prisma.TransactionClient) => {
      /*
       * FEFO 排序: expireAt 升序, NULL 排最后。
       * SQLite 的 NULL 默认排最前, 与"NULL 视为最晚到期"相反,
       * 故显式写 CASE WHEN。
       */
      const lots = await db.creditLot.findMany({
        where: {
          userId,
          remainingCredits: { gt: 0 },
          OR: [{ expireAt: null }, { expireAt: { gt: now } }],
        },
        select: { id: true, remainingCredits: true },
        orderBy: { expireAt: { sort: 'asc', nulls: 'last' } },
      });

      let remaining = credits;
      let lastLotId: string | null = null;
      const takenByLot: Array<{ lotId: string; taken: number }> = [];

      for (const lot of lots) {
        if (remaining <= 0) break;
        const take = Math.min(lot.remainingCredits, remaining);

        // 条件更新: 影响 0 行说明并发下已被扣空, 换下一批
        const res = await db.creditLot.updateMany({
          where: { id: lot.id, remainingCredits: { gte: take } },
          data: { remainingCredits: { decrement: take } },
        });
        if (res.count === 0) continue;

        takenByLot.push({ lotId: lot.id, taken: take });
        lastLotId = lot.id;
        remaining -= take;
      }

      if (remaining > 0 && !params.allowNegative) {
        // 余额不足: 整体回滚, 一分不扣
        const available = lots.reduce((s, l) => s + l.remainingCredits, 0);
        throw new AppError(40002, `积分不足: 需要 ${credits}, 可用 ${available}`, 400);
      }

      // 扣减完成后重算余额(必须在事务内, 避免与并发写入竞争)
      const agg = await db.creditLot.aggregate({
        where: { userId, remainingCredits: { gt: 0 }, OR: [{ expireAt: null }, { expireAt: { gt: now } }] },
        _sum: { remainingCredits: true },
      });
      const balance = agg._sum.remainingCredits ?? 0;

      if (credits > 0) {
        await db.creditLedger.create({
          data: {
            userId,
            type: params.ledgerType ?? 'consume',
            amount: -credits, // 消耗记负, 与获得记正形成单一符号约定
            balanceAfter: balance,
            lotId: lastLotId,
            orderId: params.orderId,
            taskId: params.taskId,
            reason: params.reason,
            operatorId: params.operatorId,
          },
        });
      }

      return { consumed: credits, balance, lotId: lastLotId, takenByLot };
    };

    /*
     * 建任务需要把「扣费 + 建任务」放进同一个事务: 任务唯一键冲突或建任务
     * 失败时, 扣减与流水必须一起回滚。否则只能靠跨事务补偿, 而补偿与重试
     * 之间没有任何原子边界 —— 补偿成功后再重试会既扣不到费又建出任务。
     */
    const result = tx ? await execute(tx) : await this.prisma.$transaction(execute);

    return { consumed: result.consumed, balance: result.balance, lotId: result.lotId };
  }

  /** 余额是否足够 */
  async hasEnough(userId: string, credits: number): Promise<boolean> {
    if (credits <= 0) return true;
    const s = await this.balanceOf(userId);
    return s.balance >= credits;
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
      /*
       * 扣减走同一套 FEFO, 保证人工扣减与消耗的口径一致。
       *
       * 流水**只记一条** `admin_adjust`：此前先 consume 写一条 `consume -N`，
       * 再补一条 `admin_adjust -N`，账本合计是 -2N，余额却只减 N —— 用户会看到
       * 一条无原因的「生成消耗」，`totalConsumed` 也被放大一倍。
       */
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

    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      // 优先扣该订单的批次, 其次扣用户其它批次(用户可能已把积分转移到长有效期批次)
      const lots = await tx.creditLot.findMany({
        where: {
          userId: order.userId,
          remainingCredits: { gt: 0 },
          OR: [{ expireAt: null }, { expireAt: { gt: now } }],
        },
        select: { id: true, remainingCredits: true, orderId: true, expireAt: true },
        // 同订单的优先, 组内按 FEFO
        orderBy: [{ orderId: 'asc' }, { expireAt: { sort: 'asc', nulls: 'last' } }],
      });

      let toReclaim = order.grantedCredits;
      const detail: Array<{ lotId: string; taken: number }> = [];
      let reclaimed = 0;

      for (const lot of lots) {
        if (toReclaim <= 0) break;
        const take = Math.min(lot.remainingCredits, toReclaim);
        const res = await tx.creditLot.updateMany({
          where: { id: lot.id, remainingCredits: { gte: take } },
          data: { remainingCredits: { decrement: take } },
        });
        if (res.count === 0) continue;
        detail.push({ lotId: lot.id, taken: take });
        reclaimed += take;
        toReclaim -= take;
      }

      const unreclaimable = toReclaim;
      const agg = await tx.creditLot.aggregate({
        where: { userId: order.userId, remainingCredits: { gt: 0 }, OR: [{ expireAt: null }, { expireAt: { gt: now } }] },
        _sum: { remainingCredits: true },
      });
      const balance = agg._sum.remainingCredits ?? 0;

      if (reclaimed > 0) {
        await tx.creditLedger.create({
          data: {
            userId: order.userId,
            type: 'refund_reclaim',
            amount: -reclaimed,
            balanceAfter: balance,
            orderId,
            reason,
            operatorId,
          },
        });
      }

      return { reclaimed, unreclaimable, detail, balance };
    });

    if (result.unreclaimable > 0) {
      // 这是必须让人看见的事实, 不能静默吞掉
      this.logger.warn(
        `退款扣回不完整: order=${orderId} 应扣 ${order.grantedCredits} 实扣 ${result.reclaimed}，` +
          `${result.unreclaimable} 因已消耗无法追回`,
      );
    }

    return result;
  }

  // ── 到期回收 ──────────────────────────────────────────────────────

  /**
   * 到期批次回收 (M9.5 调度器)。
   *
   * 回收后 remainingCredits 归零, 记 expire 流水。
   * ⚠ **不删批次** —— 删了就无法回答"这笔积分原本有多少、什么时候过期的"。
   */
  async expireLots(): Promise<{ expiredLots: number; expiredCredits: number }> {
    const now = new Date();
    const due = await this.prisma.creditLot.findMany({
      where: { remainingCredits: { gt: 0 }, expireAt: { lte: now } },
      select: { id: true, userId: true, remainingCredits: true },
    });

    let expiredCredits = 0;
    for (const lot of due) {
      const res = await this.prisma.creditLot.updateMany({
        where: { id: lot.id, remainingCredits: { gt: 0 } },
        data: { remainingCredits: 0 },
      });
      if (res.count === 0) continue;

      expiredCredits += lot.remainingCredits;
      const agg = await this.prisma.creditLot.aggregate({
        where: { userId: lot.userId, remainingCredits: { gt: 0 }, OR: [{ expireAt: null }, { expireAt: { gt: now } }] },
        _sum: { remainingCredits: true },
      });
      await this.prisma.creditLedger.create({
        data: {
          userId: lot.userId,
          type: 'expire',
          amount: -lot.remainingCredits,
          balanceAfter: agg._sum.remainingCredits ?? 0,
          lotId: lot.id,
          reason: '积分到期回收',
        },
      });
    }

    if (due.length > 0) {
      this.logger.log(`积分到期回收: ${due.length} 个批次, 共 ${expiredCredits} 积分`);
    }
    return { expiredLots: due.length, expiredCredits };
  }
}
