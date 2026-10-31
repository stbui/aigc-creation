/**
 * 账单兜底清扫（自动退款 / 转人工）。
 *
 * 为什么需要它：进程被杀、容器重启、上游连接被内核掐断时，一次已经预留积分的
 * 调用会**永远不会走到收尾**——积分冻结在 `reserved` / `running`，用户看到
 * 「扣了但没结果」，后台看到一堆挂账。任务路径有自己的租约恢复，代理路径没有。
 *
 * 因此本清扫**只处理 `taskId=''`（代理中转）的账单**，绝不触碰任务账单：
 * 任务侧由 `task-recover` 按 dispatchState 分流，两套补偿同时跑会重复退款。
 *
 * 两种状态的处置刻意不同：
 *   · `reserved` —— 请求还没发出（预留后立即置 running，仍是 reserved 说明进程
 *     在预留与派发之间就死了），**确定没有消耗**，直接原额退款；
 *   · `running` —— 请求可能已经到达上游并计费，**结果不明**，只能转人工核对。
 *     自动退款等于把可能已经花掉的钱送出去，这里不做。
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from './billing.service';

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
  ): Promise<{ refunded: number; uncertain: number }> {
    if (this.running) return { refunded: 0, uncertain: 0 };
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
          await this.billing.refund(order.id, '预留超时未执行，自动退款');
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

      if (refunded > 0 || uncertain > 0) {
        this.log.log(`账单清扫：自动退款 ${refunded} 笔，转人工核对 ${uncertain} 笔`);
      }
      return { refunded, uncertain };
    } finally {
      this.running = false;
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}
