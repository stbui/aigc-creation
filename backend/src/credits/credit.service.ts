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

/** 流水方向筛选：按有符号金额判断，兼容同为 admin_adjust 的增减流水 */
export type LedgerDirection = 'income' | 'expense';

export interface CreditReclaimResult {
  reclaimed: number;
  unreclaimable: number;
  detail: Array<{ lotId: string; taken: number }>;
}

/** C 端可见的流水类型。reserve 是生成任务的中间态，不直接暴露给用户。 */
const C_END_LEDGER_TYPES = [
  'purchase',
  'grant',
  'consume',
  'admin_adjust',
  'refund_reclaim',
  'refund',
  'expire',
] as const;

type CEndLedgerType = (typeof C_END_LEDGER_TYPES)[number];

/** 单轮到期回收上限：一批一条事务，一轮做完留给下一轮，避免长时间占住事件循环 */
const DEFAULT_EXPIRE_BATCH = 500;

/** 无积分账户或账户无流水时的稳定返回，避免调用方分别兜底 null */
export function emptyBalanceSummary(): BalanceSummary {
  return {
    balance: 0,
    expiringSoon: 0,
    totalEarned: 0,
    totalConsumed: 0,
    activeLots: 0,
    nearestExpiry: null,
  };
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

  /**
   * 批量余额总览。
   *
   * 后台总览与 CSV 导出此前逐用户调用 `balanceOf`，20 个用户就会产生 80 次
   * 查询。这里按 userId 分组一次性聚合，列表查询次数从 O(用户数) 降为常量。
   */
  async balancesOf(userIds: string[]): Promise<Map<string, BalanceSummary>> {
    const ids = [...new Set(userIds.map((id) => String(id ?? '').trim()).filter(Boolean))];
    const summaries = new Map(ids.map((id) => [id, emptyBalanceSummary()]));
    if (ids.length === 0) return summaries;

    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    const validLotWhere = {
      userId: { in: ids },
      remainingMicrocredits: { gt: 0n },
      OR: [{ expireAt: null }, { expireAt: { gt: now } }],
    };

    const [accounts, activeLots, expiringLots, earned, consumed] = await Promise.all([
      this.prisma.creditAccount.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, availableMicrocredits: true },
      }),
      this.prisma.creditLot.groupBy({
        by: ['userId'],
        where: validLotWhere,
        _count: { _all: true },
        _min: { expireAt: true },
      }),
      this.prisma.creditLot.groupBy({
        by: ['userId'],
        where: {
          ...validLotWhere,
          expireAt: { gt: now, lte: soon },
        },
        _sum: { remainingMicrocredits: true },
      }),
      // 累计获得只统计正向到账；admin_adjust 同时承载增减，不能把负向调整冲减历史获得
      this.prisma.creditLedgerEntry.groupBy({
        by: ['userId'],
        where: {
          userId: { in: ids },
          type: { in: ['purchase', 'grant', 'admin_adjust'] },
          amountMicrocredits: { gt: 0n },
        },
        _sum: { amountMicrocredits: true },
      }),
      this.prisma.creditLedgerEntry.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, type: 'consume' },
        _sum: { amountMicrocredits: true },
      }),
    ]);

    const accountByUser = new Map(accounts.map((row) => [row.userId, row.availableMicrocredits]));
    const lotByUser = new Map(activeLots.map((row) => [row.userId, row]));
    const expiringByUser = new Map(expiringLots.map((row) => [row.userId, row]));
    const earnedByUser = new Map(earned.map((row) => [row.userId, row]));
    const consumedByUser = new Map(consumed.map((row) => [row.userId, row]));

    for (const id of ids) {
      const lot = lotByUser.get(id);
      summaries.set(id, {
        balance: microcreditsToCredits(accountByUser.get(id) ?? 0n),
        expiringSoon: microcreditsToCredits(
          expiringByUser.get(id)?._sum.remainingMicrocredits ?? 0n,
        ),
        totalEarned: microcreditsToCredits(
          earnedByUser.get(id)?._sum.amountMicrocredits ?? 0n,
        ),
        // consume 流水的 amount 是负数, 取绝对值即为累计消耗
        totalConsumed: microcreditsToCredits(
          abs(consumedByUser.get(id)?._sum.amountMicrocredits ?? 0n),
        ),
        activeLots: lot?._count._all ?? 0,
        nearestExpiry: lot?._min.expireAt?.toISOString() ?? null,
      });
    }
    return summaries;
  }

  /** 余额总览 (B-49)：账户可用余额 + 批次到期信息 */
  async balanceOf(userId: string): Promise<BalanceSummary> {
    const id = String(userId ?? '').trim();
    return (await this.balancesOf([id])).get(id) ?? emptyBalanceSummary();
  }

  /**
   * 账实核对：逐用户比较「账户可用」与「Σ 批次剩余」。
   *
   * 为什么必须有这个入口：`CreditAccount` 与 `CreditLot` 是两套权威，
   * 只要有任何一处绕过 `CreditWalletService` 直接改批次，等式就会破 ——
   * 而破了之后**所有扣费都会以「账户余额与批次不一致」失败**，用户看到的是
   * 「余额明明有，却生成不了」。此前只在注释里承诺「每日对账会发现差额」，
   * 实际没有任何检测手段，只能等用户投诉。
   *
   * 只读：本方法不修数。差额要人工判断是漏扣还是漏退，自动抹平等于掩盖资损。
   *
   * @param limit 单次扫描的用户上限（按账户表分页），0 = 全量
   */
  async auditConsistency(
    limit = 500,
  ): Promise<{
    checked: number;
    mismatched: Array<{
      userId: string;
      accountAvailable: number;
      lotsRemaining: number;
      diff: number;
    }>;
  }> {
    const accounts = await this.prisma.creditAccount.findMany({
      select: { userId: true, availableMicrocredits: true },
      ...(limit > 0 ? { take: limit } : {}),
      orderBy: { updatedAt: 'desc' },
    });
    if (accounts.length === 0) return { checked: 0, mismatched: [] };

    const ids = accounts.map((a) => a.userId);
    const [reserved, lotSums] = await Promise.all([
      this.prisma.creditAccount.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, reservedMicrocredits: true },
      }),
      this.prisma.creditLot.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, remainingMicrocredits: { gt: 0n } },
        _sum: { remainingMicrocredits: true },
      }),
    ]);
    const reservedByUser = new Map(reserved.map((r) => [r.userId, r.reservedMicrocredits]));
    const lotByUser = new Map(lotSums.map((r) => [r.userId, r._sum.remainingMicrocredits ?? 0n]));

    const mismatched: Array<{
      userId: string;
      accountAvailable: number;
      lotsRemaining: number;
      diff: number;
    }> = [];
    for (const account of accounts) {
      /*
       * 等式是「可用 + 冻结 == Σ 批次剩余」：预留把可用挪到冻结，批次同时被扣，
       * 只比可用会把所有有预授权的用户全判成不一致。
       */
      const expected = account.availableMicrocredits + (reservedByUser.get(account.userId) ?? 0n);
      const actual = lotByUser.get(account.userId) ?? 0n;
      if (expected === actual) continue;
      mismatched.push({
        userId: account.userId,
        accountAvailable: microcreditsToCredits(account.availableMicrocredits),
        lotsRemaining: microcreditsToCredits(actual),
        diff: microcreditsToCredits(actual - expected),
      });
    }
    if (mismatched.length > 0) {
      this.logger.error(
        `积分账实不一致: 扫描 ${accounts.length} 个账户, ${mismatched.length} 个差额 — 需人工核对`,
      );
    }
    return { checked: accounts.length, mismatched };
  }

  /** 批次明细 (B-50) */
  async lotsOf(userId: string, includeExpired = true) {
    const now = new Date();
    const lots = await this.prisma.creditLot.findMany({
      where: {
        userId,
        ...(includeExpired
          ? {}
          : {
              remainingMicrocredits: { gt: 0n },
              OR: [{ expireAt: null }, { expireAt: { gt: now } }],
            }),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const nowMs = now.getTime();
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
            : l.expireAt && l.expireAt.getTime() <= nowMs
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
    options: {
      includeReserve?: boolean;
      offset?: number;
      type?: string;
      direction?: LedgerDirection;
    } = {},
  ) {
    const parsedLimit = Number(limit);
    const take = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 200)
      : 50;
    const parsedOffset = Number(options.offset);
    const skip = Number.isFinite(parsedOffset) ? Math.max(Math.trunc(parsedOffset), 0) : 0;

    if (options.type && !(C_END_LEDGER_TYPES as readonly string[]).includes(options.type)) {
      throw new AppError(40001, `未知积分流水类型：${options.type}`, 400);
    }
    if (options.direction && options.direction !== 'income' && options.direction !== 'expense') {
      throw new AppError(40001, `未知积分流水方向：${options.direction}`, 400);
    }

    const where: Prisma.CreditLedgerEntryWhereInput = { userId };
    if (options.type) where.type = options.type as CEndLedgerType;
    else if (!options.includeReserve) where.type = { not: 'reserve' };
    if (options.direction === 'income') where.amountMicrocredits = { gt: 0n };
    if (options.direction === 'expense') where.amountMicrocredits = { lt: 0n };

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
   *
   * **不支持透支** —— 余额不足由钱包抛 40002，调用方按语义决定是否转成 402。
   * 早先留过一个 `allowNegative` 参数，但它在传 true 时抛「不允许透支」，
   * 与参数名语义相反，且全仓无人使用，已删除：透支能力本身不存在，
   * 用一个反向命名的开关去表达"仍然不允许"只会误导读代码的人。
   */
  async consume(
    params: {
      userId: string;
      credits: number;
      taskId?: string;
      orderId?: string;
      /** 流水的业务类型。人工扣减必须传 `admin_adjust`。 */
      ledgerType?: 'consume' | 'admin_adjust';
      reason?: string;
      operatorId?: string;
      /**
       * 稳定幂等键；重复扣减直接返回已有结果，不再二次扣钱。
       *
       * 与 `grant` 的幂等键共用同一套「先查后写」语义：批量调整 / CSV 导入
       * 的重试必须靠它兜底，否则运营一次超时重试就是全量双扣。
       */
      idempotencyKey?: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ consumed: number; balance: number; lotId: string | null }> {
    const amount = creditsToMicrocredits(params.credits);
    const type = params.ledgerType ?? 'consume';
    const referenceKey = params.idempotencyKey ? `credit-consume:${params.idempotencyKey}` : null;
    const execute = async (db: Prisma.TransactionClient) => {
      if (amount <= 0n) {
        const balance = await this.wallet.balanceOf(db, params.userId);
        return { consumed: 0, balance: microcreditsToCredits(balance.availableMicrocredits), lotId: null };
      }
      if (referenceKey) {
        const existing = await db.creditLedgerEntry.findUnique({
          where: { referenceKey },
          select: { userId: true },
        });
        if (existing) {
          if (existing.userId !== params.userId) throw new AppError(40001, '积分幂等键冲突', 400);
          const balance = await this.wallet.balanceOf(db, params.userId);
          return {
            consumed: 0,
            balance: microcreditsToCredits(balance.availableMicrocredits),
            lotId: null,
          };
        }
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
          referenceKey: referenceKey ?? undefined,
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
   *
   * `idempotencyKey` 为可选但**批量 / 导入场景必须传**：一次 500 行的导入
   * 超时后重试，没有幂等键就是全量双发，且账本无法区分首次与重试。
   */
  async adminAdjust(params: {
    userId: string;
    delta: number;
    reason: string;
    operatorId: string;
    validDays?: number;
    idempotencyKey?: string;
  }): Promise<{ balance: number; idempotentHit?: boolean }> {
    const reason = params.reason?.trim();
    if (!reason) {
      throw new AppError(40001, '人工调整积分必须填写原因', 400);
    }
    if (params.delta === 0) {
      throw new AppError(40001, '调整值不能为 0', 400);
    }

    if (params.delta > 0) {
      const granted = await this.grant({
        userId: params.userId,
        credits: params.delta,
        source: 'admin_adjust',
        validDays: params.validDays,
        reason,
        operatorId: params.operatorId,
        idempotencyKey: params.idempotencyKey,
      });
      if (granted.idempotentHit) {
        return { balance: granted.balance, idempotentHit: true };
      }
    } else {
      // 人工扣减只记一条 admin_adjust 流水；再补一条 consume 会让账本合计翻倍
      const consumed = await this.consume({
        userId: params.userId,
        credits: -params.delta,
        ledgerType: 'admin_adjust',
        reason,
        operatorId: params.operatorId,
        idempotencyKey: params.idempotencyKey,
      });
      // 幂等命中时钱包没有真正扣钱，consumed 为 0 —— 直接返回当前余额，不再记日志
      if (consumed.consumed === 0 && params.idempotencyKey) {
        return { balance: consumed.balance, idempotentHit: true };
      }
    }

    const summary = await this.balanceOf(params.userId);
    this.logger.log(
      `人工调整积分: user=${params.userId} delta=${params.delta} 余额=${summary.balance} 原因="${reason}"`,
    );
    return { balance: summary.balance, idempotentHit: false };
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
   * 扣回顺序是**两段式**，不能用 `orderId asc` 之类的排序表达：
   *   1. 先扣 `orderId` 等于本单的批次（退款针对的就是这笔订单发的积分）；
   *   2. 再有缺口才回落到用户的其它批次，组内按 FEFO。
   *
   * 早先写成 `orderBy: [{ orderId: 'asc' }]` 是错的 —— 那是按 id 字符串
   * 字典序排，与「是否本单」毫无关系，很可能先扣掉用户别的订单（甚至永久
   * 批次），把本单快过期的批次剩给用户。必须显式分成两段查。
   */
  async reclaimForOrder(
    orderId: string,
    operatorId: string,
    reason: string,
    creditsToReclaim?: number,
  ): Promise<CreditReclaimResult> {
    const result = await this.prisma.$transaction((tx) =>
      this.reclaimForOrderInTransaction(tx, orderId, operatorId, reason, creditsToReclaim),
    );
    this.warnIncompleteReclaim(orderId, result);
    return result;
  }

  /**
   * 在调用方事务内扣回订单积分。
   *
   * 异步退款人工核销必须让「退款单置成功、积分扣回、订单已退金额、订单状态」
   * 同生共死；如果本方法自己开事务，就会出现积分已扣但退款记账失败的窗口。
   */
  async reclaimForOrderInTransaction(
    tx: Prisma.TransactionClient,
    orderId: string,
    operatorId: string,
    reason: string,
    creditsToReclaim?: number,
  ): Promise<CreditReclaimResult> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { userId: true, grantedCredits: true },
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);

    const granted = creditsToMicrocredits(order.grantedCredits);
    const requested = creditsToMicrocredits(creditsToReclaim ?? order.grantedCredits);
    // 部分退款只回收本次对应的份额，且任何情况下都不能超过订单发放快照。
    const target = requested < granted ? requested : granted;
    const now = new Date();
    /*
     * 两段式取批：本单批次优先，其次用户其它批次（用户可能已把积分
     * 转移到长有效期批次）。合并成一次查询无法表达「等于本单优先」——
     * 排序键只能给出全局顺序，不能给出分组优先。
     */
    const activeWhere: Prisma.CreditLotWhereInput = {
      userId: order.userId,
      remainingMicrocredits: { gt: 0n },
      OR: [{ expireAt: null }, { expireAt: { gt: now } }],
    };
    const ownLots = await tx.creditLot.findMany({
      where: { ...activeWhere, orderId },
      select: { id: true, remainingMicrocredits: true },
      orderBy: [{ expireAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    const otherLots = await tx.creditLot.findMany({
      where: { ...activeWhere, NOT: { orderId } },
      select: { id: true, remainingMicrocredits: true },
      orderBy: [{ expireAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    const lots = [...ownLots, ...otherLots];

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

    return {
      reclaimed: microcreditsToCredits(reclaimed),
      unreclaimable: microcreditsToCredits(toReclaim),
      detail,
    };
  }

  /** 退款扣回不完整是必须让人看见的事实，不能静默吞掉。 */
  warnIncompleteReclaim(orderId: string, result: CreditReclaimResult): void {
    if (result.unreclaimable > 0) {
      this.logger.warn(
        `退款扣回不完整: order=${orderId} 实扣 ${result.reclaimed}，` +
          `${result.unreclaimable} 因已消耗无法追回`,
      );
    }
  }

  // ── 到期回收 ──────────────────────────────────────────────────────

  /**
   * 到期批次回收 (M9.5 调度器)。
   *
   * 回收后 remainingMicrocredits 归零、账户可用余额同步减少，记 expire 流水。
   * ⚠ **不删批次** —— 删了就无法回答"这笔积分原本有多少、什么时候过期的"。
   *
   * 两个健壮性约束：
   *   · **单轮上限**：到期批次可能成千上万，逐条一个事务串行会长时间占住
   *     事件循环；一轮只处理 `limit` 条，剩余留到下一轮（调度器 10 分钟一次，
   *     到期按天计，积压几轮没有实际影响）。
   *   · **逐条容错**：一条因账户与批次不一致而失败，不能让整轮中断 ——
   *     已回收的不回滚，未处理的下轮再来。失败逐条 warn 并计入 `failed`，
   *     让运维能看到「有批次卡住了」，而不是只看到一条异常。
   */
  async expireLots(
    limit = DEFAULT_EXPIRE_BATCH,
  ): Promise<{ expiredLots: number; expiredCredits: number; failed: number }> {
    const now = new Date();
    const due = await this.prisma.creditLot.findMany({
      where: { remainingMicrocredits: { gt: 0n }, expireAt: { lte: now } },
      select: { id: true, userId: true, remainingMicrocredits: true },
      orderBy: { expireAt: 'asc' },
      take: Math.max(1, limit),
    });

    let expiredMicro = 0n;
    let expiredLots = 0;
    let failed = 0;
    for (const lot of due) {
      try {
        const done = await this.prisma.$transaction((tx) => this.wallet.expireLot(tx, lot));
        if (!done) continue;
        expiredLots += 1;
        expiredMicro += lot.remainingMicrocredits;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `积分到期回收失败（批次 ${lot.id} 用户 ${lot.userId} ${microcreditsToCredits(lot.remainingMicrocredits)} 积分）：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (expiredLots > 0) {
      this.logger.log(
        `积分到期回收: ${expiredLots} 个批次, 共 ${microcreditsToCredits(expiredMicro)} 积分`,
      );
    }
    return { expiredLots, expiredCredits: microcreditsToCredits(expiredMicro), failed };
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
