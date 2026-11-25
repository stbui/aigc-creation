/**
 * 任务执行器 —— 派发、轮询、切换与收尾。
 *
 * 调度由官方 `@nestjs/bullmq` 负责：一个 taskId 对应一个 BullMQ 作业，
 * Worker 的作业锁就是跨进程的执行位，轮询通过 `moveToDelayed` 延后同一个
 * 作业。这里不再维护进程内 active 集合、1s tick、扫表领取或续租定时器。
 *
 * `leaseOwner` 保留为 fencing token：每次作业执行生成一个唯一值，终态与
 * 换账单仍按它做 CAS。BullMQ 作业锁失效后，旧执行者的写入会被这个 token
 * 拦住；新执行者可以直接接管，不需要等数据库租约到期。
 *
 * 关键边界（改动任何一条都是资损）
 * ------------------------------
 *   1. **只有 `rejected_no_job` 允许切线**：上游明确没接（渠道不可用 / HTTP
 *      拒绝 / DNS、代理、TCP 建连前失败）。超时、5xx、建连后中断一律停在
 *      「结果不明」；
 *   2. **切线要换账单**：新线路的价格档可能与原线路不同，继续用旧账单会
 *      出现「按 A 的价收、走 B 的线路」；
 *   3. **落盘失败不重发**：上游已产出时把结果存进 `pendingResult` 重试落盘，
 *      再派发一次会让用户为两次上游调用付费；
 *   4. **所有终态都经过 `TaskLifecycleService`**：任务状态与账单状态同时落定。
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { GenerationTask, RouteAttempt } from '../../generated/prisma/client';
import { getCapability } from '../../capabilities/capability.registry';
import { AppError } from '../../common/app.exception';
import { CreditPriceService } from '../../credits/credit-price.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import {
  type ChannelExecution,
  ChannelRuntimeService,
  ChannelUnavailableError,
} from '../channels/channel-runtime.service';
import { restrictIntentToSpec } from '../intent/model-intent';
import { detectImageFormat } from '../media/image-format';
import { decodeDataUrl, ProtocolExecutor } from '../protocol/executor';
import type { GenerationRequest, MediaReference, ProtocolResult } from '../protocol/runtime';
import { RouteHealthService } from '../routing/route-health.service';
import { RouterService } from '../routing/router.service';
import type { RoutedModel } from '../routing/routing.types';
import { UserGroupService } from '../user-groups/user-group.service';
import { ChannelSlotService } from './channel-slot.service';
import { TaskAttemptService } from './task-attempt.service';
import { scaleMultiFusionDraft } from './task-billing-scale';
import { TaskExecutorService } from './task-executor.service';
import { TASK_ERROR, TaskLifecycleService } from './task-lifecycle.service';
import { type PendingOutput, TaskMediaService } from './task-media.service';
import { TaskRequestService } from './task-request.service';
import { TaskQueueService } from './task-queue.service';

/** 单次调用内最多推进的步数（派发 + 切换 + 轮询的成功路径） */
const MAX_STEPS = 8;
/** 落盘重试上限；超过即判失败退款，并记录上游可能已计费的事实 */
const MAX_MEDIA_RETRIES = 5;
const MEDIA_RETRY_DELAY_MS = 30_000;

/** 轮询间隔与总时限（按能力模态） */
const POLL_INTERVAL_MS: Record<string, number> = {
  image: 3_000,
  video: 5_000,
  text: 1_000,
  audio: 2_000,
};
const POLL_DEADLINE_MS: Record<string, number> = {
  image: 15 * 60_000,
  video: 60 * 60_000,
  text: 10 * 60_000,
  audio: 20 * 60_000,
};

/** 单步结果：告诉主循环下一步做什么 */
type StepResult = 'continue' | 'wait' | 'stop';

/** `processJob` 的返回值：done 结束作业，delay 让 BullMQ 延后同一个作业。 */
type ProcessOutcome = { action: 'done' } | { action: 'delay'; delayMs: number };

/** 排队任务没有账单时的处理结果。 */
type BillingGate = 'ready' | 'wait' | 'terminal';

@Injectable()
export class TaskWorkerService implements OnApplicationBootstrap {
  private readonly log = new Logger(TaskWorkerService.name);
  /** 进程标识，只用于拼每次作业执行的唯一 fencing token。 */
  private readonly processOwner =
    `${safeHostname()}:${process.pid}:${randomBytes(4).toString('hex')}`;
  /** AsyncLocalStorage 让并发作业各自持有自己的 leaseOwner，互不覆盖。 */
  private readonly execution = new AsyncLocalStorage<{ owner: string }>();

  private get owner(): string {
    return this.execution.getStore()?.owner ?? this.processOwner;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly router: RouterService,
    private readonly groups: UserGroupService,
    private readonly health: RouteHealthService,
    private readonly billing: BillingService,
    /** 限时免费判定：换线重建账单必须与首次建单同一套优惠口径 */
    private readonly price: CreditPriceService,
    private readonly channels: ChannelRuntimeService,
    private readonly slots: ChannelSlotService,
    private readonly attempts: TaskAttemptService,
    private readonly executor: TaskExecutorService,
    private readonly protocolExecutor: ProtocolExecutor,
    private readonly media: TaskMediaService,
    private readonly requests: TaskRequestService,
    private readonly lifecycle: TaskLifecycleService,
    private readonly queue: TaskQueueService,
  ) {}

  /**
   * 启动时做一次对账：数据库里 queued/running 但队列中没有作业的任务
   * （首次升级、Redis 丢数据、进程在 DB 提交后崩溃）补投一次。
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.recoverStaleTasks().catch((error) =>
      this.log.error(`启动任务对账失败: ${(error as Error).message}`),
    );
  }

  /** 投递任务；不传 taskId 时做一次全量对账（后台恢复入口）。 */
  kick(taskId?: string): void {
    void (taskId ? this.enqueueTask(taskId) : this.recoverStaleTasks()).catch((error) =>
      this.log.error(`任务投递失败: ${(error as Error).message}`),
    );
  }

  /** 把一张任务及其未执行的子任务投进 BullMQ。 */
  private async enqueueTask(taskId: string): Promise<void> {
    const tasks = await this.prisma.generationTask.findMany({
      where: {
        OR: [
          { id: taskId, status: { in: ['queued', 'running'] } },
          { parentTaskId: taskId, status: 'queued' },
        ],
      },
      select: { id: true, status: true, nextPollAt: true },
    });
    for (const task of tasks) {
      const delayMs =
        task.status === 'running' && task.nextPollAt
          ? Math.max(0, task.nextPollAt.getTime() - Date.now())
          : 0;
      await this.queue.enqueue(task.id, delayMs);
    }
  }

  /**
   * 数据库与队列对账（启动、升级与 `task-recover` 共用）。
   *
   * 只补投“数据库仍要求执行、BullMQ 里已经没有任何作业”的任务；
   * 正常 active / delayed 作业不会重复投放。
   *
   * 队列作业 ID 一次批量读取，数据库按 id 分页扫描，避免旧实现的
   * `take 500` 窗口被长期排队任务占满后，后续任务永远轮不到对账。
   *
   * @returns 本轮补投 / 转待核对的任务数
   */
  async recoverStaleTasks(): Promise<number> {
    await this.recoverUnbilledQueued();
    const scheduled = await this.queue.scheduledTaskIds();
    /*
     * 读不到队列**不是**「本轮无事可做」。
     *
     * Redis 不可达时整库的 queued/running 任务都处在「可能没人执行」的状态，
     * 静默返回 0 会让调度器把它记成一次成功，后台看不到任何异常 ——
     * 正是「静默失败三周的定时任务比不设更危险」的那种。
     * 抛出去，由调用方按失败登记连续失败次数并告警。
     */
    if (!scheduled) {
      throw new Error(
        `队列作业列表不可读，本轮跳过补投: ${this.queue.lastReadFailure ?? '未知原因'}`,
      );
    }

    const pageSize = 500;
    let cursor: string | undefined;
    let recovered = 0;
    for (;;) {
      const tasks = await this.prisma.generationTask.findMany({
        where: {
          status: { in: ['queued', 'running'] },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: pageSize,
        select: {
          id: true,
          status: true,
          routeRun: true,
          leaseOwner: true,
          nextPollAt: true,
        },
      });
      cursor = tasks[tasks.length - 1]?.id;

      for (const task of tasks) {
        if (scheduled.has(task.id)) continue;

        let nextPollAt = task.nextPollAt;
        if (task.status === 'running') {
          const attempt = await this.attempts.latest(task.id, task.routeRun);
          const state = attempt?.dispatchState ?? 'not_sent';
          if (state === 'submission_unknown') {
            // 作业已经不在队列里，而请求可能已经发出：不能重发，转人工核对。
            const claimed = await this.lifecycle.uncertain(
              task.id,
              '任务队列中没有执行中的作业，且请求可能已经发出',
              task.leaseOwner ? { leaseOwner: task.leaseOwner } : undefined,
            );
            if (claimed) recovered += 1;
            continue;
          }
          /*
           * accepted 的任务保留原来的回查时间；not_sent / rejected_no_job
           * 说明请求没发出去，应立即续跑。旧实现统一改成 now，会让一个未来
           * 的轮询时间被提前消耗。
           */
          nextPollAt = state === 'accepted' && task.nextPollAt ? task.nextPollAt : new Date();
          await this.prisma.generationTask.updateMany({
            where: { id: task.id, status: 'running', leaseOwner: task.leaseOwner },
            data: { leaseOwner: '', leaseUntil: null, nextPollAt },
          });
        }

        const delayMs = nextPollAt ? Math.max(0, nextPollAt.getTime() - Date.now()) : 0;
        try {
          await this.queue.enqueue(task.id, delayMs);
          recovered += 1;
        } catch (error) {
          this.log.error(`任务 ${task.id} 补投失败: ${(error as Error).message}`);
        }
      }
      if (tasks.length < pageSize) break;
    }
    return recovered;
  }

  /**
   * 处理「已建任务但没挂上账单」的排队任务。
   *
   * **这是存量数据的安全网，不是新建路径的设计**。建任务 + 建单 + 预留现在在
   * 同一个 Prisma 事务里（`TaskAdmissionService.createTasksWithBilling`），
   * 新任务不会出现「有任务没账单」。这里的行只可能来自：
   *   · 事务合并之前的历史数据；
   *   · 手工改库或迁移脚本留下的行。
   *
   * 先按 taskId 找账单补挂（预留其实成功了）；找不到且已超时，说明从未扣费，
   * 直接判失败即可 —— 不需要退款。
   */
  private async recoverUnbilledQueued(): Promise<void> {
    const queued = await this.prisma.generationTask.findMany({
      where: {
        status: 'queued',
        billingOrderId: null,
        // 后台重试刻意不建账单，不属于这里
        retriedFromId: null,
        createdAt: { lt: new Date(Date.now() - 60_000) },
      },
      take: 50,
      select: { id: true, createdAt: true },
    });
    for (const task of queued) {
      const order = await this.prisma.billingOrder.findFirst({
        where: { taskId: task.id },
        orderBy: { createdAt: 'desc' },
      });
      if (order) {
        await this.prisma.generationTask.updateMany({
          where: { id: task.id, billingOrderId: null },
          data: { billingOrderId: order.id },
        });
        continue;
      }
      if (Date.now() - task.createdAt.getTime() < 10 * 60_000) continue;
      const claimed = await this.prisma.generationTask.updateMany({
        where: { id: task.id, status: 'queued', billingOrderId: null },
        data: { status: 'failed', errorCode: TASK_ERROR.interrupted, stage: 'failed' },
      });
      if (claimed.count > 0) this.log.warn(`任务 ${task.id} 未挂账单且超时，已判失败（未扣费）`);
    }
  }

  // ── 单个任务 ──────────────────────────────────────────────────────

  /**
   * BullMQ Worker 的唯一业务入口。
   *
   * 作业锁保证同一 taskId 只有一个执行者；`leaseOwner` 每次执行都换新值，
   * 用作终态 / 换账单的 fencing token。返回 delay 时由 processor 调用
   * `moveToDelayed`，把同一个作业留到轮询或并发名额释放后继续。
   */
  async processJob(taskId: string): Promise<ProcessOutcome> {
    const task = await this.prisma.generationTask.findUnique({ where: { id: taskId } });
    if (!task || (task.status !== 'queued' && task.status !== 'running')) {
      return { action: 'done' };
    }
    if (task.status === 'running' && task.nextPollAt && task.nextPollAt.getTime() > Date.now()) {
      return {
        action: 'delay',
        delayMs: Math.max(0, task.nextPollAt.getTime() - Date.now()),
      };
    }

    if (task.status === 'queued') {
      // 业务并发上限在真正执行前判断；不满足就把作业延迟回队列，避免一个
      // 用户的满额任务占住 Worker 并发位、饿死同页其它用户。
      const gate = await this.queueGate(task);
      if (gate !== 'ready') {
        if (gate === 'wait') return { action: 'delay', delayMs: 60_000 };
        return { action: 'done' };
      }
      if (!(await this.hasCapacity(task))) {
        return { action: 'delay', delayMs: 1_000 };
      }
    }

    const owner = `${this.processOwner}:${randomBytes(4).toString('hex')}`;
    const now = new Date();
    const claimed = await this.prisma.generationTask.updateMany({
      where: { id: taskId, status: { in: ['queued', 'running'] } },
      data: {
        status: 'running',
        leaseOwner: owner,
        leaseUntil: null,
        nextPollAt: null,
        heartbeatAt: now,
        ...(task.status === 'queued' ? { stage: 'dispatch', progress: 5 } : {}),
      },
    });
    if (claimed.count !== 1) return { action: 'done' };

    try {
      await this.execution.run({ owner }, () => this.runClaimed(taskId));
    } catch (error) {
      this.log.error(`任务 ${taskId} 执行异常: ${(error as Error).message}`);
      await this.lifecycle.uncertain(taskId, `执行异常：${(error as Error).message}`, {
        leaseOwner: owner,
      });
    }

    const fresh = await this.prisma.generationTask.findUnique({
      where: { id: taskId },
      select: { status: true, nextPollAt: true },
    });
    if (fresh?.status !== 'running') return { action: 'done' };
    return {
      action: 'delay',
      delayMs: fresh.nextPollAt ? Math.max(0, fresh.nextPollAt.getTime() - Date.now()) : 1_000,
    };
  }

  private async queueGate(task: GenerationTask): Promise<BillingGate> {
    if (task.billingOrderId || task.retriedFromId) return 'ready';
    const order = await this.prisma.billingOrder.findFirst({
      where: { taskId: task.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (order) {
      await this.prisma.generationTask.updateMany({
        where: { id: task.id, billingOrderId: null },
        data: { billingOrderId: order.id },
      });
      return 'ready';
    }
    if (Date.now() - task.createdAt.getTime() < 10 * 60_000) return 'wait';
    const claimed = await this.prisma.generationTask.updateMany({
      where: { id: task.id, status: 'queued', billingOrderId: null },
      data: { status: 'failed', errorCode: TASK_ERROR.interrupted, stage: 'failed' },
    });
    if (claimed.count > 0) this.log.warn(`任务 ${task.id} 未挂账单且超时，已判失败（未扣费）`);
    return 'terminal';
  }

  /**
   * 用户与渠道并发上限。
   *
   * 全局并发由 BullMQ Worker 的 concurrency 控制；这里是业务上限，与旧
   * 领取逻辑保持同一口径：0 = 不限，超限的任务留在 queued 等下一轮。
   */
  private async hasCapacity(task: GenerationTask): Promise<boolean> {
    const ownerLimit = memberConcurrencyOf(task.params);
    if (ownerLimit > 0) {
      const ownerRunning = await this.prisma.generationTask.count({
        where: { ownerId: task.ownerId, status: 'running' },
      });
      if (ownerRunning >= ownerLimit) return false;
    }

    const channel = task.channelId
      ? await this.prisma.modelChannel.findUnique({
          where: { id: task.channelId },
          select: { concurrencyLimit: true },
        })
      : null;
    const channelLimit = Math.max(0, Math.trunc(channel?.concurrencyLimit ?? 0));
    if (channelLimit > 0) {
      const channelRunning = await this.prisma.generationTask.count({
        where: { channelId: task.channelId, status: 'running' },
      });
      if (channelRunning >= channelLimit) return false;
    }
    return true;
  }

  private async runClaimed(taskId: string): Promise<void> {
    try {
      const task = await this.prisma.generationTask.findUnique({ where: { id: taskId } });
      if (!task || task.status !== 'running' || task.leaseOwner !== this.owner) return;
      if (task.billingOrderId) {
        // 预留 → 运行中；CAS 失败说明账单已被结算 / 退款，不能再扣，也不能再派发
        try {
          await this.billing.markRunning(task.billingOrderId);
        } catch (error) {
          await this.uncertainOwned(taskId, `账单无法进入运行中：${(error as Error).message}`);
          return;
        }
      }
      // 先续做落盘：上游已产出、只是上次没写进存储
      if (task.pendingResult) {
        await this.persistPending(task);
        return;
      }
      await this.advance(task);
    } catch (error) {
      this.log.error(`任务 ${taskId} 执行异常: ${(error as Error).message}`);
      await this.uncertainOwned(taskId, `执行异常：${(error as Error).message}`);
    }
  }

  /** 主循环：派发 / 轮询 / 切换，直到需要等待或结束 */
  private async advance(task: GenerationTask): Promise<void> {
    const params = safeJson<Record<string, any>>(task.params, {});
    const inputIds = safeJson<string[]>(task.inputAssetIds, []);

    for (let step = 0; step < MAX_STEPS; step += 1) {
      const fresh = await this.prisma.generationTask.findUnique({ where: { id: task.id } });
      if (!fresh || fresh.status !== 'running' || fresh.leaseOwner !== this.owner) {
        // 已被终止 / 被其它执行者接管：当前执行者必须立刻停手
        return;
      }
      const runAttempts = await this.attempts.listRun(task.id, fresh.routeRun);
      const latest = runAttempts[runAttempts.length - 1] ?? null;

      if (!latest) {
        const routed = await this.resolveRoute(fresh, params, inputIds, new Set());
        if (!routed) {
          await this.failNoRoute(fresh, params);
          return;
        }
        if (this.routeSnapshotDiffers(fresh, routed) && fresh.billingOrderId) {
          /*
           * 准入与真正执行之间，线路健康度 / 分组可见性可能变化，worker 会选到
           * 另一条线路。首次 attempt 也必须和账单同生共死，否则会出现按 A 线
           * 路价格预授权、实际走 B 线路的计费错配。
           */
          const replaced = await this.replaceBilling(fresh, routed, runAttempts.length + 1);
          if (!replaced) return;
          continue;
        }
        const created = await this.startAttempt(fresh, routed, runAttempts.length + 1);
        if (!created) return;
        // 回到主循环统一经过 attempts.begin() 的 CAS；新建 attempt 不能直接派发。
        continue;
      }

      const begin = await this.attempts.begin(latest);
      if (begin.action === 'uncertain') {
        await this.uncertainOwned(task.id, '派发结果不明（请求可能已经发出）');
        return;
      }
      if (begin.action === 'done') {
        // attempt 已终结但任务还在跑：上次收尾失败。成功过说明上游可能已产出，
        // 换线路会让用户为两次调用付费，只能转人工核对
        if (begin.attempt.status === 'succeeded') {
          await this.uncertainOwned(task.id, '上游已受理并可能已产出，但结果未能落盘');
          return;
        }
        const switched = await this.switchRoute(
          fresh,
          params,
          inputIds,
          runAttempts.map((item) => item.channelModelId),
        );
        if (switched !== 'continue') return;
        continue;
      }
      if (begin.action === 'switch') {
        const switched = await this.switchRoute(
          fresh,
          params,
          inputIds,
          runAttempts.map((item) => item.channelModelId),
        );
        if (switched !== 'continue') return;
        continue;
      }
      if (begin.action === 'poll') {
        const outcome = await this.pollOnce(fresh, begin.attempt, params, inputIds);
        if (outcome !== 'continue') return;
        continue;
      }
      const outcome = await this.dispatch(fresh, begin.attempt, params, inputIds);
      if (outcome !== 'continue') return;
    }

    // 步数用尽：回到租约外的等待态，下一轮继续
    await this.release(task.id, { stage: 'poll', nextPollAt: new Date(Date.now() + 1_000) });
  }

  // ── 线路 ──────────────────────────────────────────────────────────

  /** 解析下一条可用线路；没有可用线路返回 null */
  private async resolveRoute(
    task: GenerationTask,
    params: Record<string, any>,
    inputIds: string[],
    tried: Set<string>,
  ): Promise<RoutedModel | null> {
    if (!task.modelKey) return null;
    const def = getCapability(task.capability);
    if (!def) return null;
    const intent = def.model.intent(params, { image: inputIds.length, video: 0 });
    const access = await this.groups.accessForUser(task.ownerId);
    try {
      return await this.router.resolve(access, task.capability, task.modelKey, intent, tried);
    } catch (error) {
      this.log.warn(`任务 ${task.id} 选路失败: ${(error as Error).message}`);
      return null;
    }
  }

  /** 没有可用线路：遮罩任务给 42205，其余 42204，并退款（请求没发出去） */
  private async failNoRoute(
    task: GenerationTask,
    params: Record<string, any>,
  ): Promise<StepResult> {
    const hasMask = this.requests.maskAssetId(params) !== '';
    await this.failOwned(task.id, {
      errorCode: hasMask ? TASK_ERROR.maskUnsupported : TASK_ERROR.noRoute,
      errorMessage: !task.modelKey
        ? '任务未绑定模型分组（改造前创建的任务无法继续执行）'
        : hasMask
          ? '当前没有支持遮罩重绘的可用线路'
          : '当前没有可承接该请求的模型线路',
      reason: 'generation_failed',
    });
    return 'stop';
  }

  private routeSnapshotDiffers(task: GenerationTask, routed: RoutedModel): boolean {
    return (
      task.channelModelId !== routed.channelModel.id ||
      task.channelId !== routed.channelModel.channelId
    );
  }

  private async startAttempt(
    task: GenerationTask,
    routed: RoutedModel,
    attemptNumber: number,
  ): Promise<RouteAttempt | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const attempt = await this.attempts.create(
          {
            taskId: task.id,
            routeRun: task.routeRun,
            attemptNumber,
            capabilityId: task.capability,
            modelKey: routed.modelKey,
            channelModelId: routed.channelModel.id,
            channelId: routed.channelModel.channelId,
          },
          tx,
        );
        const updated = await tx.generationTask.updateMany({
          where: { id: task.id, status: 'running', leaseOwner: this.owner },
          data: {
            modelKey: routed.modelKey,
            channelModelId: routed.channelModel.id,
            channelId: routed.channelModel.channelId,
            attempts: { increment: 1 },
            stage: 'dispatch',
            progress: 10,
          },
        });
        if (updated.count !== 1) throw new AppError(40900, '任务租约已变更，不能创建派发尝试', 409);
        return attempt;
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 40900) return null;
      throw error;
    }
  }

  /** 切换线路：按新线路原子替换账单并建 attempt，由主循环统一 CAS 后派发 */
  private async switchRoute(
    task: GenerationTask,
    params: Record<string, any>,
    inputIds: string[],
    triedRouteIds: string[],
  ): Promise<StepResult> {
    const routed = await this.resolveRoute(task, params, inputIds, new Set(triedRouteIds));
    if (!routed) {
      await this.failOwned(task.id, {
        errorCode: this.requests.maskAssetId(params)
          ? TASK_ERROR.maskUnsupported
          : TASK_ERROR.noRoute,
        errorMessage: '全部可用线路都拒绝或无法承接本次请求',
        reason: 'generation_failed',
      });
      return 'stop';
    }

    const attempts = await this.attempts.listRun(task.id, task.routeRun);
    const replaced = await this.replaceBilling(task, routed, attempts.length + 1);
    if (!replaced) return 'stop';

    // 账单已换：后续日志 / 结算必须引用新账单号
    const fresh = await this.prisma.generationTask.findUnique({ where: { id: task.id } });
    if (!fresh || fresh.status !== 'running' || fresh.leaseOwner !== this.owner) return 'stop';
    return 'continue';
  }

  /**
   * 换成新线路对应的账单：先退旧、再预留新。
   *
   * 顺序不可反：新价可能高于旧价，先预留会因为「旧预授权还占着余额」而失败，
   * 用户明明能付得起却被判余额不足。旧账单此刻一定是 `reserved` / `running`
   * （只有未派发的线路才会触发切换），退款不会与结算冲突。
   */
  private async replaceBilling(
    task: GenerationTask,
    routed: RoutedModel,
    attemptNumber: number,
  ): Promise<RouteAttempt | null> {
    const access = await this.groups.accessForUser(task.ownerId);
    let draft;
    let freeCampaignId: string | undefined;
    try {
      /*
       * 换线重建账单必须与首次建单走同一套能力级定价，不能回落到线路价格档，
       * 否则同一任务会出现两笔口径不同的账。
       */
      draft = this.billing.buildDraft(access, routed);
      if (task.capability === 'multi_fusion') {
        draft = scaleMultiFusionDraft(draft, safeJson<Record<string, unknown>>(task.params, {}));
      }
      // 已经以限时免费准入的任务在换线后仍应免费；活动恰好在排队期间结束，
      // 不能把一次已承诺的免费生成变成收费生成。
      const existingOrder = task.billingOrderId
        ? await this.prisma.billingOrder.findUnique({
            where: { id: task.billingOrderId },
            select: { promotionId: true },
          })
        : null;
      freeCampaignId =
        existingOrder?.promotionId ||
        (await this.price.freeCampaignIdOf(task.capability, task.ownerId));
      if (freeCampaignId) {
        draft = { ...draft, amountMicrocredits: 0n };
      }
    } catch (error) {
      await this.failOwned(task.id, {
        errorCode: TASK_ERROR.generationFailed,
        errorMessage: `新线路无法计价：${(error as Error).message}`,
        reason: 'generation_failed',
      });
      return null;
    }

    const authorizedLimit = await this.resolveAuthorizedLimit(task);
    if (draft.amountMicrocredits > authorizedLimit) {
      await this.failOwned(task.id, {
        errorCode: TASK_ERROR.generationFailed,
        errorMessage: '新线路价格超出本次请求的授权上限，未继续切换',
        reason: 'generation_failed',
      });
      return null;
    }

    let attempt: RouteAttempt | null = null;
    try {
      /*
       * 换线**不能突破用户原始授权上限**。
       *
       * 之前把新账单的授权上限设成新金额本身，等于「换线即重新授权」：
       * 用户为 A 线路付 10 分授权，切到更贵的 B 线路后会被扣 50。
       * 参考实现（open-ai-canvas）在原账单上做差额调整，并用
       * `validateBillingChargeLimit` 卡住「换线后金额不得超过原授权」。
       *
       * 这里按同一口径：上限取**首次建单的授权额**（`authorizedChargeMicrocredits`）。
       * 新线路更贵时直接拒绝切换（任务失败并退款），不静默多扣。
       * 限时免费单的原始授权是 0，换到收费线路同样被拒 —— 用户不该因为换线被收费。
       */
      await this.billing.replaceTaskBilling({
        userId: task.ownerId,
        taskId: task.id,
        expectedBillingOrderId: task.billingOrderId,
        expectedLeaseOwner: this.owner,
        idempotencyKey: `task:${task.id}:run${task.routeRun}:attempt${attemptNumber}`,
        draft,
        promotionId: freeCampaignId,
        chargeLimitMicrocredits: authorizedLimit,
        afterSwap: async (tx, swapped) => {
          attempt = await this.attempts.create(
            {
              taskId: task.id,
              routeRun: task.routeRun,
              attemptNumber,
              capabilityId: task.capability,
              modelKey: routed.modelKey,
              channelModelId: routed.channelModel.id,
              channelId: routed.channelModel.channelId,
            },
            tx,
          );
          const updated = await tx.generationTask.updateMany({
            where: {
              id: task.id,
              status: 'running',
              leaseOwner: this.owner,
              billingOrderId: swapped.order.id,
            },
            data: {
              modelKey: routed.modelKey,
              channelModelId: routed.channelModel.id,
              channelId: routed.channelModel.channelId,
              attempts: { increment: 1 },
              stage: 'dispatch',
              progress: 10,
            },
          });
          if (updated.count !== 1) {
            throw new AppError(40900, '任务租约或账单已变更，不能切换线路', 409);
          }
        },
      });
      return attempt;
    } catch (error) {
      // CAS 冲突说明另一执行者/终态处理已接管，当前 worker 不能反过来判失败。
      if (error instanceof AppError && error.code === 40900) {
        this.log.warn(`任务 ${task.id} 换线被并发变更中止: ${error.message}`);
        return null;
      }
      await this.failOwned(task.id, {
        errorCode: TASK_ERROR.generationFailed,
        errorMessage: `切换线路时预留积分失败：${(error as Error).message}`,
        reason: 'generation_failed',
      });
      return null;
    }
  }

  /**
   * 本次任务的用户授权上限。
   *
   * 首选任务上的 `authorizedChargeMicrocredits`（首次建单时写入）。
   * 老任务可能没有该字段（0），此时回退到旧账单的预授权额；
   * 两者都拿不到时按 0 处理 —— 换线到收费线路会被拒，宁可失败也不多扣。
   */
  private async resolveAuthorizedLimit(task: GenerationTask): Promise<bigint> {
    if (task.authorizedChargeMicrocredits > 0n) return task.authorizedChargeMicrocredits;
    if (!task.billingOrderId) return 0n;
    const old = await this.prisma.billingOrder
      .findUnique({
        where: { id: task.billingOrderId },
        select: { reservedAmountMicrocredits: true, amountMicrocredits: true },
      })
      .catch(() => null);
    if (!old) return 0n;
    return old.reservedAmountMicrocredits > 0n
      ? old.reservedAmountMicrocredits
      : old.amountMicrocredits;
  }

  // ── 派发 ──────────────────────────────────────────────────────────

  private async dispatch(
    task: GenerationTask,
    attempt: RouteAttempt,
    params: Record<string, any>,
    inputIds: string[],
  ): Promise<StepResult> {
    // attempt 已进入 submission_unknown；真正发请求前再次核对任务仍归本执行者。
    if (!(await this.ownsTaskLease(task.id))) return 'stop';
    let channel: ChannelExecution;
    let request: GenerationRequest;
    try {
      channel = await this.channels.prepare(attempt.channelModelId);
      const built = await this.requests.build({
        taskId: task.id,
        ownerId: task.ownerId,
        capability: task.capability,
        params,
        inputAssetIds: inputIds,
        channelModelId: attempt.channelModelId,
        providerModelKey: channel.providerModelKey,
      });
      request = built.request;
    } catch (error) {
      // 派发前失败：请求没有发出去，切线或退款都安全
      const unavailable = error instanceof ChannelUnavailableError;
      const failureCode = unavailable ? 'channel_unavailable' : 'request_invalid';
      await this.attempts.markFailed(attempt.id, {
        failureCode,
        failureMessage: (error as Error).message,
        rejectedNoJob: true,
      });
      if (unavailable) {
        const routes = await this.attempts.listRun(task.id, task.routeRun);
        return this.switchRoute(
          task,
          params,
          inputIds,
          routes.map((item) => item.channelModelId),
        );
      }
      await this.failOwned(task.id, {
        errorCode: TASK_ERROR.generationFailed,
        errorMessage: (error as Error).message,
        reason: 'generation_failed',
      });
      return 'stop';
    }

    const release = await this.slots
      .acquire(channel.channelId, channel.concurrencyLimit)
      .catch(() => null);
    if (!release) {
      await this.attempts.markFailed(attempt.id, {
        failureCode: 'channel_unavailable',
        failureMessage: '渠道并发已满，本次未发出请求',
        rejectedNoJob: true,
      });
      const routes = await this.attempts.listRun(task.id, task.routeRun);
      return this.switchRoute(
        task,
        params,
        inputIds,
        routes.map((item) => item.channelModelId),
      );
    }

    // 渠道准备与并发排队期间后台可能已终止任务；发送前必须再做一次租约闸门。
    if (!(await this.ownsTaskLease(task.id))) {
      release();
      return 'stop';
    }

    let result;
    try {
      result = await this.executor.create(channel.adapter, channel, request);
    } finally {
      release();
    }
    const outcome = result.outcome;

    await this.executor.logCall({
      userId: task.ownerId,
      taskId: task.id,
      billingOrderId: task.billingOrderId ?? '',
      channel,
      operation: String(request.operation ?? task.capability),
      requestKind: 'create',
      billable: outcome.status !== 'failed',
      spec: result.spec,
      method: result.spec.method,
      path: result.spec.path,
      outcome,
      pollCount: 0,
      requestBody: result.requestBody,
      responseBody: result.responseBody,
      upstreamUrl: result.upstreamUrl,
      clientIp: task.clientIp,
      requestBytes: result.requestBytes,
      responseBytes: result.responseBytes,
      videoSeconds: videoSecondsOf(params),
    });

    if (outcome.status === 'succeeded' && outcome.result) {
      await this.attempts.markSucceeded(attempt.id, outcome.providerRequestId);
      await this.finalize(
        task,
        attempt,
        outcome.result,
        channel,
        params,
        outcome.providerRequestId,
      );
      return 'stop';
    }
    if (outcome.status === 'pending') {
      const accepted = await this.attempts.markAccepted(attempt.id, outcome.providerRequestId);
      if (!accepted) {
        await this.uncertainOwned(
          task.id,
          '上游已受理，但尝试状态未能从派发中转为已受理；为避免重复调用已停止自动重试',
        );
        return 'stop';
      }
      if (task.billingOrderId && outcome.providerRequestId) {
        await this.billing.updateProviderRequestId(task.billingOrderId, outcome.providerRequestId);
      }
      await this.schedulePoll(task, outcome.providerRequestId, outcome.stage || '上游已受理');
      return 'wait';
    }

    // 失败：只有「上游明确没接」时才切线
    await this.attempts.markFailed(attempt.id, {
      failureCode: outcome.failureCode,
      failureMessage: outcome.failureMessage,
      rejectedNoJob: outcome.rejectedNoJob,
      providerRequestId: outcome.providerRequestId,
    });
    if (outcome.rejectedNoJob) {
      // 父任务可能已因同批失败取消了本任务；取消时若 attempt 仍是
      // submission_unknown，账单会先转 uncertain。这里拿到了明确拒绝，
      // 必须立即把该账单收敛为退款，不能等默认关闭的兜底清扫。
      await this.lifecycle.reconcileCancelledTask(task.id, 'generation_failed');
      this.recordHealth(outcome.failureCode, attempt, outcome.retryAfterMs);
      const routes = await this.attempts.listRun(task.id, task.routeRun);
      return this.switchRoute(
        task,
        params,
        inputIds,
        routes.map((item) => item.channelModelId),
      );
    }
    await this.uncertainOwned(
      task.id,
      `上游调用失败（${outcome.failureCode}）：${outcome.failureMessage}`,
    );
    return 'stop';
  }

  /** 派发网关：只有任务仍为 running 且租约属于本进程时才允许越过。 */
  private async ownsTaskLease(taskId: string): Promise<boolean> {
    const now = new Date();
    const owned = await this.prisma.generationTask.updateMany({
      where: { id: taskId, status: 'running', leaseOwner: this.owner },
      data: { heartbeatAt: now },
    });
    return owned.count === 1;
  }

  private failOwned(
    taskId: string,
    input: Parameters<TaskLifecycleService['fail']>[1],
  ): Promise<boolean> {
    return this.lifecycle.fail(taskId, input, { leaseOwner: this.owner });
  }

  private uncertainOwned(taskId: string, message: string): Promise<boolean> {
    return this.lifecycle.uncertain(taskId, message, { leaseOwner: this.owner });
  }

  // ── 轮询 ──────────────────────────────────────────────────────────

  private async pollOnce(
    task: GenerationTask,
    attempt: RouteAttempt,
    params: Record<string, any>,
    inputIds: string[],
  ): Promise<StepResult> {
    if (!(await this.ownsTaskLease(task.id))) return 'stop';
    const deadline =
      task.createdAt.getTime() +
      (POLL_DEADLINE_MS[modalityOf(task.capability)] ?? POLL_DEADLINE_MS.image);
    if (Date.now() > deadline) {
      await this.uncertainOwned(task.id, '上游长时间未返回结果');
      return 'stop';
    }

    let channel: ChannelExecution;
    let request: GenerationRequest;
    try {
      channel = await this.channels.prepare(attempt.channelModelId);
      const built = await this.requests.build({
        taskId: task.id,
        ownerId: task.ownerId,
        capability: task.capability,
        params,
        inputAssetIds: inputIds,
        channelModelId: attempt.channelModelId,
        providerModelKey: channel.providerModelKey,
      });
      request = built.request;
    } catch (error) {
      // 已受理任务不能切线：结果可能已经产出
      await this.uncertainOwned(task.id, `轮询前准备失败：${(error as Error).message}`);
      return 'stop';
    }

    const release = await this.slots
      .acquire(channel.channelId, channel.concurrencyLimit)
      .catch(() => null);
    if (!release) {
      await this.schedulePoll(task, task.providerRequestId ?? '', '等待渠道并发');
      return 'wait';
    }
    // 排队等槽位期间任务可能已被终止或接管；GET 发出前必须再确认一次租约。
    if (!(await this.ownsTaskLease(task.id))) {
      release();
      return 'stop';
    }
    let result;
    try {
      result = await this.executor.poll(
        channel.adapter,
        channel,
        request,
        attempt.providerRequestId || task.providerRequestId || '',
      );
    } finally {
      release();
    }
    const outcome = result.outcome;

    await this.executor.logCall({
      userId: task.ownerId,
      taskId: task.id,
      billingOrderId: task.billingOrderId ?? '',
      channel,
      operation: String(request.operation ?? task.capability),
      requestKind: 'poll',
      billable: outcome.status === 'succeeded',
      spec: result.spec,
      method: result.spec.method,
      path: result.spec.path,
      outcome,
      pollCount:
        (await this.prisma.apiCallLog.count({ where: { taskId: task.id, requestKind: 'poll' } })) +
        1,
      requestBody: result.requestBody,
      responseBody: result.responseBody,
      upstreamUrl: result.upstreamUrl,
      clientIp: task.clientIp,
      requestBytes: result.requestBytes,
      responseBytes: result.responseBytes,
      videoSeconds: videoSecondsOf(params),
    });

    if (outcome.status === 'succeeded' && outcome.result) {
      await this.attempts.markSucceeded(attempt.id, outcome.providerRequestId);
      if (task.billingOrderId) {
        await this.billing.updateProviderRequestId(task.billingOrderId, outcome.providerRequestId);
      }
      await this.finalize(
        task,
        attempt,
        outcome.result,
        channel,
        params,
        outcome.providerRequestId,
      );
      return 'stop';
    }
    if (outcome.status === 'pending') {
      await this.schedulePoll(task, outcome.providerRequestId, outcome.stage || '上游生成中');
      return 'wait';
    }

    await this.attempts.markFailed(attempt.id, {
      failureCode: outcome.failureCode,
      failureMessage: outcome.failureMessage,
      rejectedNoJob: false,
      providerRequestId: outcome.providerRequestId,
    });
    await this.uncertainOwned(
      task.id,
      `轮询失败（${outcome.failureCode}）：${outcome.failureMessage}`,
    );
    return 'stop';
  }

  /** 安排下一次回查，并释放执行位（等待期间不占进程） */
  private async schedulePoll(
    task: GenerationTask,
    providerRequestId: string,
    stage: string,
  ): Promise<void> {
    const interval = POLL_INTERVAL_MS[modalityOf(task.capability)] ?? POLL_INTERVAL_MS.image;
    await this.prisma.generationTask.updateMany({
      where: { id: task.id, status: 'running', leaseOwner: this.owner },
      data: {
        stage: 'poll',
        progress: 50,
        pollStage: stage,
        nextPollAt: new Date(Date.now() + interval),
        leaseOwner: '',
        leaseUntil: null,
        heartbeatAt: new Date(),
        ...(providerRequestId ? { providerRequestId } : {}),
      },
    });
  }

  private async release(taskId: string, data: { stage: string; nextPollAt: Date }): Promise<void> {
    await this.prisma.generationTask.updateMany({
      where: { id: taskId, status: 'running', leaseOwner: this.owner },
      data: {
        stage: data.stage,
        nextPollAt: data.nextPollAt,
        leaseOwner: '',
        leaseUntil: null,
        heartbeatAt: new Date(),
      },
    });
  }

  private recordHealth(failureCode: string, attempt: RouteAttempt, retryAfterMs?: number): void {
    const retryAfter = failureCode === 'upstream_429' ? (retryAfterMs ?? 30_000) : undefined;
    this.health.recordFailure(
      failureCode,
      {
        channelId: attempt.channelId,
        channelModelId: attempt.channelModelId,
        routeId: attempt.id,
      },
      retryAfter,
    );
  }

  // ── 收尾 ──────────────────────────────────────────────────────────

  /** 上游已产出：下载 → 标识 → 落盘 → 结算 */
  private async finalize(
    task: GenerationTask,
    attempt: RouteAttempt,
    result: ProtocolResult,
    channel: ChannelExecution,
    params: Record<string, any>,
    providerRequestId: string,
  ): Promise<void> {
    const current = await this.prisma.generationTask.findUnique({
      where: { id: task.id },
      select: { status: true, leaseOwner: true },
    });
    // 终止检查点：后台可能在模型调用期间终止了任务
    if (!current || current.status !== 'running' || current.leaseOwner !== this.owner) {
      this.log.warn(`任务 ${task.id} 已离开执行态，丢弃本次产出`);
      return;
    }

    const references = collectReferences(result);
    if (references.length === 0) {
      /*
       * 上游返回成功却解析不到任何产出：可能是协议字段变更，也可能上游已经
       * 生成并计费、只是链接缺失。自动退款会让平台白付一次调用，按「结果不明」
       * 冻结积分等人工核对，与超时 / 5xx / 建连后中断同一口径。
       */
      await this.uncertainOwned(task.id, '上游返回成功但没有任何可解析的产出');
      return;
    }

    try {
      const outputs = await this.download(references, channel, task.capability, params);
      const stored = await this.media.persist(toMediaRef(task), outputs);
      const promoted = await this.lifecycle.succeed(
        {
          id: task.id,
          ownerId: task.ownerId,
          billingOrderId: task.billingOrderId,
          providerRequestId: task.providerRequestId,
        },
        {
          outputAssetIds: stored.map((item) => item.assetId),
          aigcMeta: JSON.stringify(stored[0]?.aigcMeta ?? {}),
          providerRequestId,
          outputDurationMs: outputs[0]?.durationMs ?? undefined,
        },
        { leaseOwner: this.owner },
      );
      if (!promoted) await this.media.discardCreated(task.id, stored);
      void attempt;
    } catch (error) {
      if (TaskMediaService.isLabelError(error)) {
        // fail-closed：未标识的产出绝不交付
        await this.failOwned(task.id, {
          errorCode: TASK_ERROR.labelFailed,
          errorMessage: (error as Error).message,
          reason: 'generation_failed',
        });
        return;
      }
      await this.deferMedia(task.id, result, (error as Error).message);
    }
  }

  /** 落盘失败：先存结果、延后重试，不再回上游要第二次 */
  private async deferMedia(taskId: string, result: ProtocolResult, message: string): Promise<void> {
    const payload = JSON.stringify(result);
    if (payload.length > 4 * 1024 * 1024) {
      // 内联大结果不适合进库：上游已成功，绝不能按普通失败退款，转人工核对
      await this.uncertainOwned(taskId, `产出落盘失败且无法暂存：${message}`);
      return;
    }
    this.log.warn(
      `任务 ${taskId} 产出落盘失败，${MEDIA_RETRY_DELAY_MS / 1000}s 后重试：${message}`,
    );
    await this.prisma.generationTask.updateMany({
      where: { id: taskId, status: 'running', leaseOwner: this.owner },
      data: {
        pendingResult: payload,
        mediaRecoveryError: message.slice(0, 1000),
        stage: 'recover',
        nextPollAt: new Date(Date.now() + MEDIA_RETRY_DELAY_MS),
        leaseOwner: '',
        leaseUntil: null,
      },
    });
  }

  /** 重试把暂存的上游结果落盘 */
  private async persistPending(task: GenerationTask): Promise<void> {
    const payload = task.pendingResult ?? '';
    let retries = 0;
    let result: ProtocolResult;
    try {
      const parsed = JSON.parse(payload);
      result = parsed?.result ?? parsed;
      retries = Number(parsed?.retries ?? 0);
    } catch {
      await this.uncertainOwned(task.id, '暂存的上游结果已损坏，产物状态待核对');
      return;
    }

    const attempt = await this.attempts.latest(task.id, task.routeRun);
    if (!attempt) {
      await this.uncertainOwned(task.id, '找不到产出对应的线路尝试，产物状态待核对');
      return;
    }
    let channel: ChannelExecution;
    try {
      channel = await this.channels.prepare(attempt.channelModelId);
    } catch (error) {
      // 渠道被停用不能成为「用户拿不到图也不退钱」的理由：超过上限即退款
      await this.retryOrFail(task, result, retries + 1, (error as Error).message);
      return;
    }

    try {
      const outputs = await this.download(
        collectReferences(result),
        channel,
        task.capability,
        safeJson(task.params, {}),
      );
      const stored = await this.media.persist(toMediaRef(task), outputs);
      const promoted = await this.lifecycle.succeed(
        {
          id: task.id,
          ownerId: task.ownerId,
          billingOrderId: task.billingOrderId,
          providerRequestId: task.providerRequestId,
        },
        {
          outputAssetIds: stored.map((item) => item.assetId),
          aigcMeta: JSON.stringify(stored[0]?.aigcMeta ?? {}),
          providerRequestId: task.providerRequestId ?? '',
          outputDurationMs: outputs[0]?.durationMs ?? undefined,
        },
        { leaseOwner: this.owner },
      );
      if (!promoted) await this.media.discardCreated(task.id, stored);
    } catch (error) {
      if (TaskMediaService.isLabelError(error)) {
        await this.failOwned(task.id, {
          errorCode: TASK_ERROR.labelFailed,
          errorMessage: (error as Error).message,
          reason: 'generation_failed',
        });
        return;
      }
      await this.retryOrFail(task, result, retries + 1, (error as Error).message);
    }
  }

  private async retryOrFail(
    task: GenerationTask,
    result: ProtocolResult,
    retries: number,
    message: string,
  ): Promise<void> {
    if (retries >= MAX_MEDIA_RETRIES) {
      // 上游已经成功且计费，只是本地落盘失败；按普通失败退款会造成「双损」
      await this.uncertainOwned(task.id, `产出落盘连续失败 ${retries} 次：${message}`);
      return;
    }
    await this.prisma.generationTask.updateMany({
      where: { id: task.id, status: 'running', leaseOwner: this.owner },
      data: {
        pendingResult: JSON.stringify({ result, retries }),
        mediaRecoveryError: message.slice(0, 1000),
        stage: 'recover',
        nextPollAt: new Date(Date.now() + MEDIA_RETRY_DELAY_MS),
        leaseOwner: '',
        leaseUntil: null,
      },
    });
  }

  /** 产物下载：公网地址 / 内联 data URL 统一成字节 */
  private async download(
    references: MediaReference[],
    channel: ChannelExecution,
    capability: string,
    params: Record<string, any>,
  ): Promise<PendingOutput[]> {
    const outputs: PendingOutput[] = [];
    for (const reference of references) {
      const dataUrl = String(reference.dataUrl ?? '').trim();
      let buffer: Buffer;
      let mime: string;
      if (dataUrl) {
        const decoded = decodeDataUrl(dataUrl);
        if (!decoded) throw new Error('产出素材的 dataUrl 格式无效');
        buffer = decoded.data;
        mime = reference.mimeType || decoded.mimeType;
      } else {
        const downloaded = await this.protocolExecutor.download(reference, channel.runtime);
        buffer = downloaded.data;
        mime = reference.mimeType || downloaded.mimeType;
      }
      let format = normalizeMediaMime(mime, reference.kind);
      if (!format) format = inferMediaMime(buffer, reference.kind);

      // 多图融合偶发返回低于所选档位的尺寸：按所选档位对齐，避免静默降级。
      // 只对融合能力生效 —— 其余能力的 `ratio/size` 语义不同，误对齐会改坏成品
      if (
        capability === 'multi_fusion' &&
        !String(format).startsWith('video/') &&
        !String(format).startsWith('audio/')
      ) {
        const normalized = await this.media.normalizeFusionOutput(
          buffer,
          format,
          params.ratio,
          params.size,
        );
        buffer = normalized.buffer;
        format = normalized.format;
      }
      outputs.push({ buffer, format, durationMs: durationOf(format, params) });
    }
    return outputs;
  }
}

// ── 工具 ────────────────────────────────────────────────────────────

function collectReferences(result: ProtocolResult): MediaReference[] {
  return [...(result.images ?? []), ...(result.videos ?? []), ...(result.audios ?? [])].filter(
    (item) => Boolean(item?.url || item?.dataUrl),
  );
}

function toMediaRef(task: GenerationTask) {
  return {
    id: task.id,
    projectId: task.projectId,
    ownerId: task.ownerId,
    capability: task.capability,
    params: task.params,
  };
}

function modalityOf(capability: string): string {
  const def = getCapability(capability);
  return def?.modality ?? 'image';
}

function creditsOf(microcredits: bigint): number {
  const scale = 1_000_000n;
  return Number((microcredits + scale - 1n) / scale);
}

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * 任务快照里的会员并发上限。
 *
 * 建任务时写入，worker 领取时按它分批；存量任务或后台重试任务缺该字段时
 * 按 0（不限）处理，由渠道与进程安全上限兜底。
 */
function memberConcurrencyOf(raw: string | null | undefined): number {
  const params = safeJson<Record<string, unknown>>(raw, {});
  const value = Number(params.__memberConcurrency);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/** 只接受完整的 `type/subtype`；缺 subtype 的一律当作未知，交给字节魔数判断 */
function normalizeMediaMime(value: string, kind?: string): string {
  const mime = String(value ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!/^[a-z]+\/[a-z0-9.+-]+$/.test(mime)) return '';
  if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/'))
    return mime;
  return kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mpeg' : '';
}

/** 字节魔数兜底：多家上游返回无扩展名链接，按 URL 猜格式必然出错 */
function inferMediaMime(buffer: Buffer, kind?: string): string {
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  if (buffer.length >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33)
    return 'audio/mpeg';
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return 'video/webm';
  }
  // 图片走既有魔数嗅探（PNG / JPEG / WebP / GIF）
  const sniffed = detectImageFormat(buffer);
  if (sniffed) return sniffed;
  return kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mpeg' : 'image/jpeg';
}

function durationOf(format: string, params: Record<string, any>): number | null {
  if (!String(format).startsWith('video/') && !String(format).startsWith('audio/')) return null;
  const seconds = Number(params?.duration ?? params?.videoSeconds);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
}

/** 统一从任务参数读取计费时长，轮询日志不能依赖 GET 请求体。 */
function videoSecondsOf(params: Record<string, any>): number {
  const seconds = Number(params?.duration ?? params?.videoSeconds);
  return Number.isFinite(seconds) && seconds > 0 ? Math.trunc(seconds) : 0;
}

function safeHostname(): string {
  try {
    return hostname();
  } catch {
    return 'host';
  }
}
