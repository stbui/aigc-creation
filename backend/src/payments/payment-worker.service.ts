import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentOrderService } from './payment-order.service';
import { PaymentNotificationService } from './payment-notification.service';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { PaymentConfigService } from './payment-config.service';
import { PaymentExceptionService } from './payment-exception.service';
import { allAdapters } from './adapters';

const TICK_MS = 15_000;
/** 通知处理租约回收阈值 */
const PROCESSING_STALE_MS = 5 * 60_000;
/** 查单轮询：pending 订单上次查单超过 30 秒 */
const QUERY_INTERVAL_MS = 30_000;
/** 自动对账时间（Asia/Shanghai） */
const AUTO_RECONCILE_HOUR = 10;
const AUTO_RECONCILE_MINUTE = 15;
const AUTO_RECONCILE_BACKOFF_MS = [15 * 60_000, 30 * 60_000, 60 * 60_000];
const AUTO_RECONCILE_MAX_ATTEMPTS = 3;

/**
 * 支付后台任务。
 *
 * 串行执行，任一步失败只记日志、不中断后续步骤。单实例串行即可：
 * 多实例部署时必须改用数据库租约或拆成独立进程，不能只靠内存锁。
 *
 * `PAYMENT_WORKER_ENABLED=false` 仅用于测试/排障，不改变接口行为。
 */
@Injectable()
export class PaymentWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: PaymentOrderService,
    private readonly notifications: PaymentNotificationService,
    private readonly reconciliation: PaymentReconciliationService,
    private readonly configs: PaymentConfigService,
    private readonly exceptions: PaymentExceptionService,
  ) {}

  onModuleInit(): void {
    if (process.env.PAYMENT_WORKER_ENABLED === 'false') {
      this.logger.warn('支付后台任务已禁用 (PAYMENT_WORKER_ENABLED=false)');
      return;
    }
    // 启动后 15 秒起跑，不阻塞 Nest 启动
    this.timer = setTimeout(() => void this.loop(), TICK_MS);
    this.logger.log(`支付后台任务已启动（每 ${TICK_MS / 1000}s 一次）`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async loop(): Promise<void> {
    try {
      await this.tick();
    } catch (e) {
      this.logger.error(`支付后台任务异常: ${(e as Error).message}`);
    } finally {
      this.timer = setTimeout(() => void this.loop(), TICK_MS);
    }
  }

  /** 测试直接调用 */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.recycleStaleNotifications();
      await this.processDueNotifications();
      await this.reconciliation.recoverStaleRuns();
      await this.closeExpiredOrders();
      await this.queryPendingOrders();
      await this.autoReconcile();
    } finally {
      this.running = false;
    }
  }

  private async recycleStaleNotifications(): Promise<void> {
    const stale = await this.prisma.paymentNotification.updateMany({
      where: { status: 'processing', updatedAt: { lt: new Date(Date.now() - PROCESSING_STALE_MS) } },
      data: { status: 'failed', nextAttemptAt: new Date() },
    });
    if (stale.count > 0) this.logger.warn(`回收卡住的通知: ${stale.count} 条`);
  }

  private async processDueNotifications(): Promise<void> {
    const due = await this.prisma.paymentNotification.findMany({
      where: { status: { in: ['pending', 'failed'] }, nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: 'asc' },
      take: 50,
      select: { id: true },
    });
    for (const item of due) {
      try {
        await this.notifications.retry(item.id);
      } catch (e) {
        this.logger.error(`通知重试失败 ${item.id}: ${(e as Error).message}`);
      }
    }
  }

  private async closeExpiredOrders(): Promise<void> {
    // 统一走 PaymentOrderService.closeExpired：关单前逐个渠道查单、失败不本地关单。
    // 不要在 worker 里直接 updateMany 改 cancelled（旧调度器正是这么漏掉已付款订单的）。
    const closed = await this.orders.closeExpired(50);
    if (closed > 0) this.logger.log(`超时订单已关闭: ${closed} 笔`);
  }

  private async queryPendingOrders(): Promise<void> {
    const cutoff = new Date(Date.now() - QUERY_INTERVAL_MS);
    const pending = await this.prisma.order.findMany({
      where: {
        status: 'pending',
        expiresAt: { gt: new Date() },
        channel: { notIn: ['free'] },
        AND: [
          { OR: [{ providerConfigId: { not: null } }, { checkoutMode: { not: null } }] },
          { OR: [{ lastQueriedAt: null }, { lastQueriedAt: { lt: cutoff } }] },
        ],
      },
      take: 20,
      select: { id: true },
    });
    for (const item of pending) {
      try {
        await this.orders.query({ orderId: item.id, actor: { kind: 'worker' } });
      } catch (e) {
        this.logger.warn(`轮询查单 ${item.id} 失败: ${(e as Error).message}`);
      }
    }
  }

  /**
   * 本地 10:15 后，对昨日已启用且支持对账的渠道重试至多三次。
   *
   * 成功/失败/下次重试时间都落库，不能只看进程内日期：重启会丢掉失败信息，
   * 多实例也会各自重复下载同一账单。
   */
  private async autoReconcile(): Promise<void> {
    const now = new Date();
    const shanghai = new Date(now.getTime() + 8 * 3600 * 1000);
    const hour = shanghai.getUTCHours();
    const minute = shanghai.getUTCMinutes();
    if (hour < AUTO_RECONCILE_HOUR || (hour === AUTO_RECONCILE_HOUR && minute < AUTO_RECONCILE_MINUTE)) {
      return;
    }
    const yesterday = new Date(shanghai.getTime() - 24 * 3600 * 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    const billDate = `${yesterday.getUTCFullYear()}-${p(yesterday.getUTCMonth() + 1)}-${p(yesterday.getUTCDate())}`;

    for (const adapter of allAdapters()) {
      if (!adapter.descriptor.supportsReconciliation) continue;
      const instances = (await this.configs.listInstances(adapter.descriptor.id)).filter(
        (instance) => instance.enabled,
      );
      for (const instance of instances) {
        const providerId = adapter.descriptor.id;
        const providerInstanceId = instance.instanceId;
        const state = await this.prisma.paymentAutoReconcileState.upsert({
          where: {
            providerId_providerInstanceId_billDate: {
              providerId,
              providerInstanceId,
              billDate,
            },
          },
          create: {
            providerId,
            providerInstanceId,
            billDate,
            status: 'pending',
            attempts: 0,
            nextAttemptAt: now,
          },
          update: {},
        });
        if (state.status === 'succeeded') continue;
        if (state.attempts >= AUTO_RECONCILE_MAX_ATTEMPTS) continue;
        if (state.nextAttemptAt.getTime() > now.getTime()) continue;

        try {
          const result = await this.reconciliation.run({
            providerId,
            providerInstanceId,
            billDate,
            actorId: 'worker',
          });
          if (result.run.status !== 'completed') {
            throw new Error(result.run.error || '对账任务未完成');
          }
          await this.prisma.paymentAutoReconcileState.update({
            where: { id: state.id },
            data: {
              status: 'succeeded',
              attempts: { increment: 1 },
              lastError: null,
            },
          });
        } catch (e) {
          const attempts = state.attempts + 1;
          const error = (e as Error).message;
          const exhausted = attempts >= AUTO_RECONCILE_MAX_ATTEMPTS;
          const delay = AUTO_RECONCILE_BACKOFF_MS[Math.min(attempts - 1, AUTO_RECONCILE_BACKOFF_MS.length - 1)];
          await this.prisma.paymentAutoReconcileState.update({
            where: { id: state.id },
            data: {
              status: exhausted ? 'failed' : 'pending',
              attempts,
              lastError: error.slice(0, 500),
              nextAttemptAt: new Date(Date.now() + delay),
            },
          });
          this.logger.error(
            `自动对账失败 (${providerId}/${providerInstanceId} ${billDate}, 第 ${attempts}/${AUTO_RECONCILE_MAX_ATTEMPTS} 次): ${error}`,
          );
          if (exhausted) {
            await this.exceptions.recordReconciliationFailure({
              providerId,
              providerInstanceId,
              billDate,
              error: `自动对账连续 ${attempts} 次失败: ${error}`,
            });
          }
        }
      }
    }
    this.logger.log(`自动对账检查完成: ${billDate}`);
  }
}
