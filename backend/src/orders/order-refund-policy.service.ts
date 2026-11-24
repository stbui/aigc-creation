import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/app.exception';
import { formatCredits } from '../model/infra/microcredits';
import { PrismaService } from '../prisma/prisma.service';

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

/**
 * 退款金额与积分回收规则。
 *
 * 调用方必须在订单行锁内再调用一次 assertRefundPolicy，不能复用事务外的判断结果。
 */
@Injectable()
export class OrderRefundPolicyService {
  constructor(private readonly prisma: PrismaService) {}

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
  async assertRefundPolicy(params: {
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
        creditsExpired: number;
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
    const paidBase =
      params.order.paidCents > 0
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
      const deadline = params.order.paidAt.getTime() + windowDays * 24 * 3600 * 1000;
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
    const ratioCap = Math.floor((paidBase * maxRatioBps) / 10000) - params.order.refundedCents;
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
            sum + refund.creditsReclaimed + refund.creditsUnreclaimable + refund.creditsExpired,
          0,
        );
      const cumulativeCreditTarget =
        paidBase > 0
          ? Number(
              (BigInt(params.order.grantedCredits) *
                BigInt(params.order.refundedCents + params.amountCents)) /
                BigInt(paidBase),
            )
          : 0;
      const creditsToReclaim = Math.max(0, cumulativeCreditTarget - previousAccountedCredits);
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
}
