/**
 * 任务终态与计费收口。
 *
 * 移植自 open-ai-canvas `internal/app/task_execution.go` 的 `finishTask` /
 * `failTask` / `cancelTask`。所有「任务结束」的动作都收在这里，是因为
 * **任务状态与账单状态必须同时落定**：只改任务不改账单会漏退款，
 * 只改账单不改任务会让用户看到「生成中」却已经扣费。
 *
 * 三条不可违背的规则：
 *   1. **CAS 认领**：只有真正把任务从 queued/running 改写为终态的那次调用
 *      才动账单，重复执行安全（worker 崩溃后恢复、后台终止与执行路径会并发）；
 *   2. **失败按账单退款，不按任务快照**：账单里是用户实际被预留的金额，
 *      任务上的 `creditCost` 只是展示快照；
 *   3. **上游可能已产出时不退款**：转 `uncertain` 等人工核对，
 *      自动退款等于平台白付一次模型调用费。
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { CreditService } from '../../credits/credit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { getCapability } from '../../capabilities/capability.registry';
import { AppError } from '../../common/app.exception';

/** 任务终态错误码（与前端展示口径一致） */
export const TASK_ERROR = {
  /** 生成失败（有线路但全部失败 / 执行异常） */
  generationFailed: '42201',
  /** 执行中断（进程崩溃，已回收） */
  interrupted: '42202',
  /** AIGC 标识失败（fail-closed） */
  labelFailed: '42203',
  /** 没有可用线路 */
  noRoute: '42204',
  /** 遮罩重绘没有支持编辑端点的线路 */
  maskUnsupported: '42205',
  /** 结果不明，待人工核对（不退款） */
  uncertain: '42206',
} as const;

export type TaskErrorCode = (typeof TASK_ERROR)[keyof typeof TASK_ERROR];

export type FailureReason = 'generation_failed' | 'cancelled_by_admin' | 'recovered';

@Injectable()
export class TaskLifecycleService {
  private readonly log = new Logger(TaskLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    /** 存量任务（无账单）的退款仍走旧积分服务 */
    private readonly credit: CreditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * 任务成功：结算账单并把任务置为 succeeded。
   *
   * 结算失败**不回滚产出**：用户已经拿到图，账单转 `uncertain` 由人工核对；
   * 把已交付的结果收回只会让用户既没图也没积分。
   */
  async succeed(
    task: { id: string; ownerId: string; billingOrderId: string | null; providerRequestId: string | null },
    input: { outputAssetIds: string[]; aigcMeta: string; providerRequestId?: string; outputDurationMs?: number },
  ): Promise<void> {
    const claimed = await this.prisma.generationTask.updateMany({
      where: { id: task.id, status: 'running' },
      data: {
        status: 'succeeded',
        outputAssetId: input.outputAssetIds[0] ?? null,
        outputAssetIds: JSON.stringify(input.outputAssetIds),
        aigcMeta: input.aigcMeta,
        provider: 'gateway',
        stage: 'done',
        progress: 100,
        leaseOwner: '',
        leaseUntil: null,
        nextPollAt: null,
        pollStage: '',
        mediaRecoveryError: null,
        pendingResult: null,
        ...(input.providerRequestId ? { providerRequestId: input.providerRequestId } : {}),
      },
    });
    if (claimed.count === 0) {
      // 已被后台终止 / 恢复流程改写：产出已登记，但任务不属于本次调用
      this.log.warn(`任务 ${task.id} 在落结果前已离开 running，跳过结算`);
      return;
    }
    if (!task.billingOrderId) return;
    try {
      await this.billing.settle(task.billingOrderId, {
        providerRequestId: input.providerRequestId ?? task.providerRequestId ?? undefined,
        audioDurationMs: input.outputDurationMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error(`任务 ${task.id} 已交付但结算失败，转人工核对：${message}`);
      await this.billing.markUncertain(task.billingOrderId, `结算失败：${message}`).catch(() => undefined);
    }
  }

  /** 任务失败：退款（默认）或转人工核对 */
  async fail(
    taskId: string,
    input: { errorCode: TaskErrorCode | string; errorMessage?: string; reason: FailureReason; refund?: boolean },
  ): Promise<boolean> {
    const task = await this.prisma.generationTask.findUnique({ where: { id: taskId } });
    if (!task) return false;
    const claimed = await this.prisma.generationTask.updateMany({
      where: { id: taskId, status: { in: ['queued', 'running'] } },
      data: {
        status: 'failed',
        errorCode: String(input.errorCode),
        stage: 'failed',
        leaseOwner: '',
        leaseUntil: null,
        nextPollAt: null,
        pendingResult: null,
        ...(input.errorMessage ? { mediaRecoveryError: input.errorMessage.slice(0, 1000) } : {}),
      },
    });
    if (claimed.count === 0) return false;

    // 同一次生成的其余图不再继续：父任务已失败，子任务产出的图也凑不成一套
    await this.cancelQueuedChildren(taskId, input.reason);

    if (input.refund === false) {
      await this.toUncertain(taskId, task.billingOrderId, input.errorMessage ?? input.reason);
      return true;
    }
    // 同批次的图只由父任务发一条汇总通知，否则一次失败会在站内信里刷出 N 条
    await this.refund(task, input.reason, input.errorMessage ?? '', !task.parentTaskId);
    return true;
  }

  /**
   * 结果不明：任务判失败但**不退款**，账单转 uncertain 等人工核对。
   *
   * 只用于「请求可能已经打到上游」的失败（超时 / 5xx / 连接中断 / 轮询失败）。
   * 自动退款会让平台为一次已完成的上游调用白付钱，也可能让用户拿回积分
   * 同时又拿到图。
   */
  async uncertain(taskId: string, message: string): Promise<boolean> {
    const task = await this.prisma.generationTask.findUnique({ where: { id: taskId } });
    if (!task) return false;
    const claimed = await this.prisma.generationTask.updateMany({
      where: { id: taskId, status: { in: ['queued', 'running'] } },
      data: {
        status: 'failed',
        errorCode: TASK_ERROR.uncertain,
        stage: 'uncertain',
        mediaRecoveryError: message.slice(0, 1000),
        leaseOwner: '',
        leaseUntil: null,
        nextPollAt: null,
        pendingResult: null,
      },
    });
    if (claimed.count === 0) return false;
    await this.toUncertain(taskId, task.billingOrderId, message);
    return true;
  }

  /**
   * 后台终止。
   *
   * 已派发的任务不能自动退款：上游可能正在生成并计费。此时任务置 `cancelled`，
   * 账单转 `uncertain`，由运营按上游调用记录决定退款还是结算。
   */
  async cancel(taskId: string, reason: string): Promise<{ status: string; billing: string }> {
    const task = await this.prisma.generationTask.findUnique({ where: { id: taskId } });
    if (!task) throw new AppError(40400, '任务不存在', 404);
    if (!['queued', 'running'].includes(task.status)) {
      throw new AppError(40000, '仅等待中或执行中的任务可终止', 400);
    }

    const dispatched = await this.wasDispatched(taskId, task.routeRun);
    const claimed = await this.prisma.generationTask.updateMany({
      where: { id: taskId, status: { in: ['queued', 'running'] } },
      data: {
        status: 'cancelled',
        stage: 'cancelled',
        leaseOwner: '',
        leaseUntil: null,
        nextPollAt: null,
        pendingResult: null,
      },
    });
    if (claimed.count === 0) throw new AppError(40009, '任务状态已变更，请刷新后重试', 409);

    await this.cancelQueuedChildren(taskId, 'cancelled_by_admin');

    if (dispatched) {
      await this.toUncertain(taskId, task.billingOrderId, `后台终止：${reason}`);
      return { status: 'cancelled', billing: 'uncertain' };
    }
    await this.refund(task, 'cancelled_by_admin', reason, !task.parentTaskId);
    return { status: 'cancelled', billing: task.billingOrderId ? 'refunded' : 'none' };
  }

  // ── 内部 ──────────────────────────────────────────────────────────

  /**
   * 父任务结束（失败 / 终止）时取消尚未派发的子任务并退回它们自己的账单。
   *
   * 每张图各有一份预授权，取消就要按各自账单退回，否则这批钱会一直冻结在
   * 钱包里。**已经打到上游的不碰** —— 上游可能正在生成并计费，让它们按自己的
   * 结果收尾，避免多出一次「结果不明」。
   */
  private async cancelQueuedChildren(parentTaskId: string, reason: FailureReason): Promise<void> {
    const children = await this.prisma.generationTask.findMany({
      where: { parentTaskId, status: { in: ['queued', 'running'] } },
    });
    for (const child of children) {
      if (await this.wasDispatched(child.id, child.routeRun)) continue;
      const claimed = await this.prisma.generationTask
        .updateMany({
          where: { id: child.id, status: { in: ['queued', 'running'] } },
          data: {
            status: 'cancelled',
            stage: 'cancelled',
            leaseOwner: '',
            leaseUntil: null,
            nextPollAt: null,
            pendingResult: null,
          },
        })
        .catch(() => undefined);
      // 通知由父任务按整批汇总发一条，这里只退钱
      if (claimed?.count) await this.refund(child, reason, '同批次的其它图已取消', false);
    }
  }

  /** 是否已有请求离开过宿主（决定能否自动退款） */
  private async wasDispatched(taskId: string, routeRun: number): Promise<boolean> {
    const attempt = await this.prisma.routeAttempt.findFirst({
      where: { taskId, routeRun },
      orderBy: { attemptNumber: 'desc' },
    });
    if (!attempt) return false;
    return attempt.dispatchState === 'accepted' || attempt.dispatchState === 'submission_unknown';
  }

  /** 退款：新任务按账单，存量任务（无账单）回退旧积分批次 */
  private async refund(
    task: {
      id: string;
      ownerId: string;
      billingOrderId: string | null;
      creditCost: number;
      parentTaskId?: string | null;
    },
    reason: FailureReason,
    message: string,
    /** 是否发站内信：同批次被父任务连坐取消的其它图沉默退钱，由父任务汇总发一条 */
    notify = true,
  ): Promise<void> {
    /*
     * 零价且无账单的任务（管理员重试）根本没扣过钱：既不退款，也不能发
     * 「积分已退回 0」—— 一条假退款通知比不通知更让人困惑。
     */
    if (!task.billingOrderId && task.creditCost === 0) return;
    const labels: Record<FailureReason, string> = {
      generation_failed: '生成失败自动退还',
      cancelled_by_admin: '任务被终止自动退还',
      recovered: '任务中断自动退还',
    };
    try {
      if (task.billingOrderId) {
        await this.billing.refund(task.billingOrderId, message || labels[reason]);
      } else if (task.creditCost > 0) {
        // P4-b 之前的存量任务：积分由旧 CreditService 扣，没有账单行
        await this.credit.grant({
          userId: task.ownerId,
          credits: task.creditCost,
          source: 'grant',
          taskId: task.id,
          idempotencyKey: `refund:task:${task.id}`,
          reason: labels[reason],
        });
      }
    } catch (error) {
      // 退款失败是资损，必须显式告警而非静默
      this.log.error(
        `★资损: 退款失败 task=${task.id} user=${task.ownerId}: ${(error as Error).message}`,
      );
      return;
    }
    if (!notify) return;
    await this.notifyFailure(task.ownerId, task.id, labels[reason], task);
  }

  /**
   * 本次实际退回的积分：父任务把整批（自己 + 同批其它图）加在一起。
   *
   * 一次提交拆成 N 张时每张各有账单，逐张发「10 积分已退回」会让一次失败在
   * 站内信里刷出 N 条，且看不出总共退了多少；汇总成一条才对得上用户付的那笔。
   */
  private async refundedCreditsOf(task: {
    id: string;
    billingOrderId: string | null;
    parentTaskId?: string | null;
  }): Promise<number> {
    const taskIds = [task.id];
    if (!task.parentTaskId) {
      const children = await this.prisma.generationTask.findMany({
        where: { parentTaskId: task.id },
        select: { id: true },
      });
      taskIds.push(...children.map((child) => child.id));
    }
    const orders = await this.prisma.billingOrder.findMany({
      where: { taskId: { in: taskIds }, status: 'refunded' },
      select: { refundedAmountMicrocredits: true },
    });
    return orders.reduce((sum, order) => sum + Number(order.refundedAmountMicrocredits / 1_000_000n), 0);
  }

  private async toUncertain(taskId: string, billingOrderId: string | null, message: string): Promise<void> {
    if (!billingOrderId) return;
    await this.billing.markUncertain(billingOrderId, message.slice(0, 1000)).catch((error: Error) => {
      this.log.error(`账单转待核对失败 task=${taskId}: ${error.message}`);
    });
  }

  /** 只有**真的退成功**才通知：退款失败时发「积分已退回」会变成假证据 */
  private async notifyFailure(
    ownerId: string,
    taskId: string,
    reason: string,
    task: { id: string; billingOrderId: string | null; parentTaskId?: string | null },
  ): Promise<void> {
    try {
      const row = await this.prisma.generationTask
        .findUnique({ where: { id: taskId }, select: { capability: true } })
        .catch(() => null);
      const capabilityName = row?.capability
        ? getCapability(row.capability)?.name ?? row.capability
        : '生成任务';
      const credits = await this.refundedCreditsOf(task).catch(() => 0);
      await this.notifications.notify({
        userId: ownerId,
        type: 'task_failed',
        vars: { capability: capabilityName, credits, reason },
        fallbackTitle: '生成失败，积分已退回',
        fallbackBody: `任务「${capabilityName}」失败，${credits} 积分已原额退回。`,
        link: '/works',
      });
    } catch (error) {
      this.log.warn(`任务失败通知发送失败 task=${taskId}: ${(error as Error).message}`);
    }
  }
}
