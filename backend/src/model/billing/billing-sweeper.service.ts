/**
 * 账单兜底清扫（自动退款 / 转人工）。
 *
 * 为什么需要它：进程被杀、容器重启、上游连接被内核掐断时，一次已经预留积分的
 * 调用会**永远不会走到收尾**——积分冻结在 `reserved` / `running`，用户看到
 * 「扣了但没结果」，后台看到一堆挂账。任务路径有自己的租约恢复，代理路径没有。
 *
 * 两段职责，边界不能混：
 *   1. **代理账单**（`taskId=''`）：无条件兜底。`reserved` 超 30 分钟直接退款
 *      （预留后立即置 running，仍是 reserved 说明请求没发出去）；`running`
 *      超 60 分钟转人工（上游可能已计费，不能自动退）。
 *   2. **任务账单**（`taskId!=''`）：**只有运营显式打开
 *      `generate.billingAutoRefund` 才执行**。口径与后台「待核对」队列一致：
 *      uncertain / running 超 40 分钟 / 任务已失败但仍预留。已出作品或正在
 *      补交付（`pendingResult`，或 running 任务仍有 `mediaRecoveryError`）的
 *      订单必须排除 —— 自动退款会让平台白付上游费用、用户也失去「重试保存」。
 *
 * 默认关闭的原因：待核对订单**可能已经在上游产生费用**，退与不退是运营口径，
 * 不是技术默认。开关打开后每轮重新读，关掉立即停。
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { BillingService, REVIEW_RUNNING_STALE_MS } from './billing.service';

/** 预留超过这么久仍未置运行态 = 派发前就中断了 */
export const RESERVED_TTL_MS = 30 * 60 * 1000;
/** 运行态超过这么久没有收尾 = 执行者已死（上游可能已经计费） */
export const RUNNING_TTL_MS = 60 * 60 * 1000;
/** 单轮处理上限：一轮扫太多会长时间占住事件循环，剩余留到下一轮 */
const BATCH_SIZE = 200;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 单轮清扫的 TTL 覆盖 —— 供验收脚本注入。
 *
 * 为什么 TTL 必须可注入：两个默认 TTL 是 30 分钟与 60 分钟，等不起。
 * 把它们写死在模块常量里，验收脚本就只能靠改时钟去等，测试既慢又不可靠。
 * 注入后脚本可以直接把 TTL 压到毫秒级，断言两条迁移本身。
 */
export interface BillingSweepOptions {
  /** 预留态超过多久判为「派发前中断」 */
  reservedTtlMs?: number;
  /** 运行态超过多久判为「结果不明」 */
  runningTtlMs?: number;
  /** 单轮处理上限 */
  batchSize?: number;
}

@Injectable()
export class BillingSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(BillingSweeperService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    if (!(this.config.get<boolean>('model.billingSweepEnabled') ?? true)) {
      this.log.warn('账单兜底清扫已关闭（MODEL_BILLING_SWEEP_ENABLED=false），挂账只能人工处理');
      return;
    }
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * 跑一轮；返回本轮处置条数（后台 / 冒烟脚本可直接调用）
   *
   * @param now     判定「过期」的基准时刻
   * @param options TTL 覆盖；不传时用模块默认（30 分钟 / 60 分钟）
   */
  async sweep(
    now = new Date(),
    options: BillingSweepOptions = {},
  ): Promise<{ refunded: number; uncertain: number; taskRefunded: number }> {
    if (this.running) return { refunded: 0, uncertain: 0, taskRefunded: 0 };
    this.running = true;
    try {
      const reservedTtlMs = options.reservedTtlMs ?? RESERVED_TTL_MS;
      const runningTtlMs = options.runningTtlMs ?? RUNNING_TTL_MS;
      const batchSize = options.batchSize ?? BATCH_SIZE;
      const reservedCutoff = new Date(now.getTime() - reservedTtlMs);
      const runningCutoff = new Date(now.getTime() - runningTtlMs);
      const staleReserved = await this.prisma.billingOrder.findMany({
        where: { taskId: '', status: 'reserved', createdAt: { lt: reservedCutoff } },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: batchSize,
      });
      let refunded = 0;
      for (const order of staleReserved) {
        try {
          await this.billing.refund(order.id, '预留超时未执行，自动退款', 'auto_sweep');
          refunded += 1;
        } catch (error) {
          this.log.warn(`自动退款失败（账单 ${order.id}）：${messageOf(error)}`);
        }
      }

      const staleRunning = await this.prisma.billingOrder.findMany({
        where: {
          taskId: '',
          status: 'running',
          OR: [{ startedAt: { lt: runningCutoff } }, { startedAt: null, createdAt: { lt: runningCutoff } }],
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: batchSize,
      });
      let uncertain = 0;
      for (const order of staleRunning) {
        try {
          await this.billing.markUncertain(order.id, '中转执行超时，费用状态待核对');
          uncertain += 1;
        } catch (error) {
          this.log.warn(`转人工失败（账单 ${order.id}）：${messageOf(error)}`);
        }
      }

      // 任务账单的自动退回：只有运营显式打开开关才执行
      const autoRefundTasks = await this.settings.getBoolean('generate.billingAutoRefund');
      const taskRefunded = autoRefundTasks ? await this.sweepTaskReview(now, batchSize) : 0;

      if (refunded > 0 || uncertain > 0 || taskRefunded > 0) {
        this.log.log(
          `账单清扫：代理自动退款 ${refunded} 笔，代理转人工 ${uncertain} 笔，任务账单自动退回 ${taskRefunded} 笔`,
        );
      }
      return { refunded, uncertain, taskRefunded };
    } finally {
      this.running = false;
    }
  }

  /**
   * 任务账单的自动退回（「待核对」队列里确定没有交付的那部分）。
   *
   * 排除已出作品 / 正在补交付的订单：上游可能已经产出，自动退款会让平台
   * 白付上游费用，用户也失去「重试保存」。这类订单只能人工处置。
   */
  private async sweepTaskReview(now: Date, batchSize: number): Promise<number> {
    const staleBefore = new Date(now.getTime() - REVIEW_RUNNING_STALE_MS);
    // 用 EXISTS 在库里判断任务终态，避免把全部 failed/cancelled 任务 id
    // 搬进 Node 再拼 `IN (...)`。任务表增长后后者会成为明显的查询放大点。
    const candidates = await this.prisma.$queryRaw<Array<{ id: string; taskId: string }>>`
      SELECT b.id, b.taskId
      FROM "BillingOrder" AS b
      WHERE b.taskId <> ''
        AND (
          b.status = 'uncertain'
          OR (b.status = 'running' AND b.updatedAt < ${staleBefore})
          OR (
            b.status = 'reserved'
            AND EXISTS (
              SELECT 1
              FROM "GenerationTask" AS t
              WHERE t.id = b.taskId
                AND t.status IN ('failed', 'cancelled')
            )
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "GenerationTask" AS t
          WHERE t.id = b.taskId
            AND (
              t.outputAssetId IS NOT NULL
              OR t.pendingResult IS NOT NULL
              OR (t.mediaRecoveryError IS NOT NULL AND t.status = 'running')
            )
        )
      ORDER BY b.createdAt ASC
      LIMIT ${batchSize}
    `;
    if (candidates.length === 0) return 0;

    // 已出作品 / 正在补交付的任务不自动退：它们可能稍后交付成功
    const taskIds = [...new Set(candidates.map((item) => item.taskId).filter((id) => id !== ''))];
    const protectedTasks =
      taskIds.length > 0
        ? await this.prisma.generationTask.findMany({
            where: {
              id: { in: taskIds },
              OR: [
                { outputAssetId: { not: null } },
                { pendingResult: { not: null } },
                // 普通失败路径也会写 mediaRecoveryError；只有任务仍在运行、
                // 结果正在重试落盘时才算“正在补交付”，否则会永久卡住退款队列。
                { mediaRecoveryError: { not: null }, status: 'running' },
              ],
            },
            select: { id: true },
          })
        : [];
    const protectedIds = new Set(protectedTasks.map((task) => task.id));

    let refunded = 0;
    for (const order of candidates) {
      if (protectedIds.has(order.taskId)) continue;
      try {
        // 退款与「已核对」标记在同一事务内落地，避免钱退了但账单仍显示待处理。
        await this.billing.refund(
          order.id,
          '系统自动退回：冻结积分自动退回已开启',
          'auto_sweep',
          { resolvedBy: 'system:auto-refund', resolutionNote: '冻结积分自动退回' },
        );
        refunded += 1;
      } catch (error) {
        this.log.warn(`任务账单自动退款失败（账单 ${order.id}）：${messageOf(error)}`);
      }
    }
    return refunded;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}
