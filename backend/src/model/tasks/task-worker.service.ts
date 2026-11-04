/**
 * 任务执行器 —— 领取、派发、轮询、切换与收尾。
 *
 * 移植自 open-ai-canvas `internal/app/task_worker.go` + `task_execution.go`：
 * 事件驱动的单步执行模型，每一步做完就把执行位让出去，避免长轮询占住进程。
 *
 * 执行模型
 * --------
 *   · `queued`  → 条件更新（CAS）领取为 `running`，写入租约；
 *   · `running` + 租约过期 → `recover` 按 attempt 的 `dispatchState` 分流；
 *   · `running` + `nextPollAt` 到期 → 重新领取执行位回查上游；
 *   · 每 15s 续租一次，租约 45s 过期 —— 进程被杀后最迟 45s 被接管。
 *
 * 关键边界（改动任何一条都是资损）
 * ------------------------------
 *   1. **只有 `rejected_no_job` 允许切线**：上游明确没接（渠道不可用 / 401 /
 *      403 / 404 / 429）。超时、5xx、连接中断一律停在「结果不明」；
 *   2. **切线要换账单**：新线路的价格档可能与原线路不同，继续用旧账单会
 *      出现「按 A 的价收、走 B 的线路」；
 *   3. **落盘失败不重发**：上游已产出时把结果存进 `pendingResult` 重试落盘，
 *      再派发一次会让用户为两次上游调用付费；
 *   4. **所有终态都经过 `TaskLifecycleService`**：任务状态与账单状态同时落定。
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { GenerationTask, RouteAttempt } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProtocolExecutor, decodeDataUrl } from '../protocol/executor';
import type { GenerationRequest, MediaReference, ProtocolResult } from '../protocol/runtime';
import type { RoutedModel } from '../routing/routing.types';
import { RouterService } from '../routing/router.service';
import { detectImageFormat } from '../media/image-format';
import { RouteHealthService } from '../routing/route-health.service';
import { BillingService } from '../billing/billing.service';
import { CreditPriceService } from '../../credits/credit-price.service';
import { UserGroupService } from '../user-groups/user-group.service';
import { getCapability } from '../../capabilities/capability.registry';
import { restrictIntentToSpec } from '../intent/model-intent';
import { ChannelRuntimeService, ChannelUnavailableError, type ChannelExecution } from '../channels/channel-runtime.service';
import { ChannelSlotService } from './channel-slot.service';
import { TaskAttemptService } from './task-attempt.service';
import { TaskExecutorService } from './task-executor.service';
import { TaskLifecycleService, TASK_ERROR } from './task-lifecycle.service';
import { TaskMediaService, type PendingOutput } from './task-media.service';
import { TaskRequestService } from './task-request.service';

/** 租约时长：进程被杀后最迟这么久被接管 */
const TASK_LEASE_MS = 45_000;
/** 续租间隔：必须显著小于租约时长，否则一次 GC 停顿就会丢租约 */
const LEASE_RENEW_MS = 15_000;
/** 调度节拍 */
const WORKER_TICK_MS = 1_000;
/** 本进程同时执行的任务数（轮询等待期间不占额度） */
const MAX_ACTIVE_TASKS = 8;
/** 单次调用内最多推进的步数（派发 + 切换 + 轮询的成功路径） */
const MAX_STEPS = 8;
/** 落盘重试上限；超过即判失败退款，并记录上游可能已计费的事实 */
const MAX_MEDIA_RETRIES = 5;
const MEDIA_RETRY_DELAY_MS = 30_000;

/** 轮询间隔与总时限（按能力模态） */
const POLL_INTERVAL_MS: Record<string, number> = { image: 3_000, video: 5_000, text: 1_000, audio: 2_000 };
const POLL_DEADLINE_MS: Record<string, number> = {
  image: 15 * 60_000,
  video: 60 * 60_000,
  text: 10 * 60_000,
  audio: 20 * 60_000,
};

/** 单步结果：告诉主循环下一步做什么 */
type StepResult = 'continue' | 'wait' | 'stop';

@Injectable()
export class TaskWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TaskWorkerService.name);
  /** 租约持有者标识：host + pid + 随机后缀，重启后不会与旧租约混淆 */
  private readonly owner = `${safeHostname()}:${process.pid}:${randomBytes(4).toString('hex')}`;
  private readonly active = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly router: RouterService,
    private readonly groups: UserGroupService,
    private readonly health: RouteHealthService,
    private readonly billing: BillingService,
    /** 后台能力覆盖价：换线重建账单必须与首次建单同一套定价 */
    private readonly price: CreditPriceService,
    private readonly channels: ChannelRuntimeService,
    private readonly slots: ChannelSlotService,
    private readonly attempts: TaskAttemptService,
    private readonly executor: TaskExecutorService,
    private readonly protocolExecutor: ProtocolExecutor,
    private readonly media: TaskMediaService,
    private readonly requests: TaskRequestService,
    private readonly lifecycle: TaskLifecycleService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), WORKER_TICK_MS);
    (this.timer as any).unref?.();
    // 启动即跑一轮：进程重启后遗留的任务不应等满一个节拍
    setTimeout(() => void this.tick(), 0);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** 立即调度一轮（准入建任务后调用，省掉最多 1s 的等待） */
  kick(): void {
    void this.tick();
  }

  // ── 调度 ──────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    if (this.stopped || this.ticking) return;
    this.ticking = true;
    try {
      await this.claimQueued();
      await this.claimDuePolls();
      await this.recoverExpiredLeases();
      await this.recoverUnbilledQueued();
    } catch (error) {
      this.log.error(`任务调度异常: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private launch(taskId: string): void {
    if (this.active.has(taskId)) return;
    this.active.add(taskId);
    void this.run(taskId).finally(() => this.active.delete(taskId));
  }

  /** 领取排队任务：CAS 成功才执行 */
  private async claimQueued(): Promise<void> {
    const free = MAX_ACTIVE_TASKS - this.active.size;
    if (free <= 0) return;
    const candidates = await this.prisma.generationTask.findMany({
      // 有账单的走预留；零价无账单的只有一种：后台重试（刻意不二次扣费）。
      // 多图产出的每张图都有自己的账单，与单图任务走同一条预留链路。
      where: {
        status: 'queued',
        OR: [
          { billingOrderId: { not: null } },
          { creditCost: 0, retriedFromId: { not: null } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: free,
      select: { id: true },
    });
    for (const candidate of candidates) {
      const now = new Date();
      const claimed = await this.prisma.generationTask.updateMany({
        where: { id: candidate.id, status: 'queued' },
        data: {
          status: 'running',
          leaseOwner: this.owner,
          leaseUntil: new Date(now.getTime() + TASK_LEASE_MS),
          heartbeatAt: now,
          stage: 'dispatch',
          progress: 5,
        },
      });
      if (claimed.count === 1) this.launch(candidate.id);
    }
  }

  /** 领取到点的轮询任务：等待期间 `leaseOwner` 为空，领取时再写 */
  private async claimDuePolls(): Promise<void> {
    const free = MAX_ACTIVE_TASKS - this.active.size;
    if (free <= 0) return;
    const now = new Date();
    const due = await this.prisma.generationTask.findMany({
      where: { status: 'running', leaseOwner: '', nextPollAt: { lte: now } },
      orderBy: { nextPollAt: 'asc' },
      take: free,
      select: { id: true },
    });
    for (const item of due) {
      const claimed = await this.prisma.generationTask.updateMany({
        where: { id: item.id, status: 'running', leaseOwner: '', nextPollAt: { lte: now } },
        data: {
          leaseOwner: this.owner,
          leaseUntil: new Date(Date.now() + TASK_LEASE_MS),
          nextPollAt: null,
          heartbeatAt: now,
          stage: 'poll',
        },
      });
      if (claimed.count === 1) this.launch(item.id);
    }
  }

  /**
   * 回收租约过期的运行中任务（调度任务与启动恢复共用）。
   *
   * @returns 本轮处理的条数
   */
  async recoverStaleTasks(): Promise<number> {
    return this.recoverExpiredLeases();
  }

  /** 租约过期的运行中任务：按 attempt 的派发状态决定续跑 / 失败 / 待核对 */
  private async recoverExpiredLeases(): Promise<number> {
    const now = new Date();
    const expired = await this.prisma.generationTask.findMany({
      where: { status: 'running', leaseOwner: { not: '' }, leaseUntil: { lt: now } },
      take: 50,
      select: { id: true, routeRun: true, leaseOwner: true, pendingResult: true },
    });
    let recovered = 0;
    for (const task of expired) {
      const attempt = await this.attempts.latest(task.id, task.routeRun);
      const state = attempt?.dispatchState ?? 'not_sent';
      if (state === 'submission_unknown') {
        // 执行者可能在请求已发出后死掉：不能重发，交给人工核对
        await this.lifecycle.uncertain(task.id, '执行者租约过期，且请求可能已经发出');
        recovered += 1;
        continue;
      }
      /*
       * 其余三态都可以立刻续跑：
       *   · not_sent / rejected_no_job —— 请求没发出去，`advance` 会重新选路派发；
       *   · accepted —— 上游已受理，`advance` 回到轮询；
       * 租约清空 + `nextPollAt=now` 才会被 `claimDuePolls` 重新领取。
       */
      await this.prisma.generationTask.updateMany({
        where: { id: task.id, status: 'running', leaseOwner: task.leaseOwner },
        data: { leaseOwner: '', leaseUntil: null, nextPollAt: new Date() },
      });
      recovered += 1;
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

  private async run(taskId: string): Promise<void> {
    const renew = setInterval(() => {
      void this.renewLease(taskId);
    }, LEASE_RENEW_MS);
    (renew as any).unref?.();
    try {
      const task = await this.prisma.generationTask.findUnique({ where: { id: taskId } });
      if (!task || task.status !== 'running' || task.leaseOwner !== this.owner) return;
      if (task.billingOrderId) {
        // 预留 → 运行中；CAS 失败说明账单已被结算 / 退款，不能再扣，也不能再派发
        try {
          await this.billing.markRunning(task.billingOrderId);
        } catch (error) {
          await this.lifecycle.uncertain(taskId, `账单无法进入运行中：${(error as Error).message}`);
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
      await this.lifecycle.uncertain(taskId, `执行异常：${(error as Error).message}`);
    } finally {
      clearInterval(renew);
    }
  }

  private async renewLease(taskId: string): Promise<void> {
    await this.prisma.generationTask
      .updateMany({
        where: { id: taskId, status: 'running', leaseOwner: this.owner },
        data: { leaseUntil: new Date(Date.now() + TASK_LEASE_MS), heartbeatAt: new Date() },
      })
      .catch(() => undefined);
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
        const attempt = await this.startAttempt(fresh, routed, runAttempts.length + 1);
        const outcome = await this.dispatch(fresh, attempt, params, inputIds);
        if (outcome !== 'continue') return;
        continue;
      }

      const begin = await this.attempts.begin(latest);
      if (begin.action === 'uncertain') {
        await this.lifecycle.uncertain(task.id, '派发结果不明（请求可能已经发出）');
        return;
      }
      if (begin.action === 'done') {
        // attempt 已终结但任务还在跑：上次收尾失败。成功过说明上游可能已产出，
        // 换线路会让用户为两次调用付费，只能转人工核对
        if (begin.attempt.status === 'succeeded') {
          await this.lifecycle.uncertain(task.id, '上游已受理并可能已产出，但结果未能落盘');
          return;
        }
        const switched = await this.switchRoute(fresh, params, inputIds, runAttempts.map((item) => item.routeId));
        if (switched !== 'continue') return;
        continue;
      }
      if (begin.action === 'switch') {
        const switched = await this.switchRoute(fresh, params, inputIds, runAttempts.map((item) => item.routeId));
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
    if (!task.logicalModelId) return null;
    const model = await this.router.findModel(task.logicalModelId);
    if (!model || !model.enabled || model.archivedAt !== null) return null;
    const def = getCapability(task.capability);
    if (!def) return null;
    const intent = restrictIntentToSpec(
      model.productSpec,
      def.model.intent(params, { image: inputIds.length, video: 0 }),
    );
    const access = await this.groups.accessForUser(task.ownerId);
    try {
      return await this.router.resolve(access, task.logicalModelId, intent, tried);
    } catch (error) {
      this.log.warn(`任务 ${task.id} 选路失败: ${(error as Error).message}`);
      return null;
    }
  }

  /** 没有可用线路：遮罩任务给 42205，其余 42204，并退款（请求没发出去） */
  private async failNoRoute(task: GenerationTask, params: Record<string, any>): Promise<StepResult> {
    const hasMask = this.requests.maskAssetId(params) !== '';
    await this.lifecycle.fail(task.id, {
      errorCode: hasMask ? TASK_ERROR.maskUnsupported : TASK_ERROR.noRoute,
      errorMessage: !task.logicalModelId
        ? '任务未绑定前台模型（改造前创建的任务无法继续执行）'
        : hasMask
          ? '当前没有支持遮罩重绘的可用线路'
          : '当前没有可承接该请求的模型线路',
      reason: 'generation_failed',
    });
    return 'stop';
  }

  private async startAttempt(
    task: GenerationTask,
    routed: RoutedModel,
    attemptNumber: number,
  ): Promise<RouteAttempt> {
    const attempt = await this.attempts.create({
      taskId: task.id,
      routeRun: task.routeRun,
      attemptNumber,
      logicalModelId: routed.logicalModel.id,
      logicalModelRevisionId: routed.revisionId,
      routeId: routed.route.id,
      channelModelId: routed.channelModel.id,
      channelId: routed.channelModel.channelId,
    });
    await this.prisma.generationTask.update({
      where: { id: task.id },
      data: {
        logicalModelRevisionId: routed.revisionId,
        routeId: routed.route.id,
        channelModelId: routed.channelModel.id,
        attempts: { increment: 1 },
        stage: 'dispatch',
        progress: 10,
      },
    });
    return attempt;
  }

  /** 切换线路：先建下一条尝试，再按新线路换账单，最后派发 */
  private async switchRoute(
    task: GenerationTask,
    params: Record<string, any>,
    inputIds: string[],
    triedRouteIds: string[],
  ): Promise<StepResult> {
    const routed = await this.resolveRoute(task, params, inputIds, new Set(triedRouteIds));
    if (!routed) {
      await this.lifecycle.fail(task.id, {
        errorCode: this.requests.maskAssetId(params) ? TASK_ERROR.maskUnsupported : TASK_ERROR.noRoute,
        errorMessage: '全部可用线路都拒绝或无法承接本次请求',
        reason: 'generation_failed',
      });
      return 'stop';
    }

    const attempts = await this.attempts.listRun(task.id, task.routeRun);
    const attempt = await this.startAttempt(task, routed, attempts.length + 1);
    const replaced = await this.replaceBilling(task, routed, attempt.attemptNumber);
    if (!replaced) return 'stop';

    // 账单已换：后续日志 / 结算必须引用新账单号
    const fresh = await this.prisma.generationTask.findUnique({ where: { id: task.id } });
    if (!fresh || fresh.status !== 'running' || fresh.leaseOwner !== this.owner) return 'stop';
    return this.dispatch(fresh, attempt, params, inputIds);
  }

  /**
   * 换成新线路对应的账单：先退旧、再预留新。
   *
   * 顺序不可反：新价可能高于旧价，先预留会因为「旧预授权还占着余额」而失败，
   * 用户明明能付得起却被判余额不足。旧账单此刻一定是 `reserved` / `running`
   * （只有未派发的线路才会触发切换），退款不会与结算冲突。
   */
  private async replaceBilling(task: GenerationTask, routed: RoutedModel, attemptNumber: number): Promise<boolean> {
    const access = await this.groups.accessForUser(task.ownerId);
    let draft;
    try {
      /*
       * 换线重建账单必须与首次建单走同一套定价：后台覆盖价在这里同样要生效，
       * 否则「首次按 77 扣、换线后又按线路原价 5 扣」，用户会看到金额莫名变小，
       * 财务上则是同一任务两笔口径不同的账。
       */
      const overrideCost = await this.price.resolve(task.capability);
      draft = this.billing.buildDraft(access, routed, overrideCost);
    } catch (error) {
      await this.lifecycle.fail(task.id, {
        errorCode: TASK_ERROR.generationFailed,
        errorMessage: `新线路无法计价：${(error as Error).message}`,
        reason: 'generation_failed',
      });
      return false;
    }

    if (task.billingOrderId) {
      await this.billing.refund(task.billingOrderId, '线路切换，替换账单', 'route_switch').catch((error: Error) => {
        this.log.warn(`任务 ${task.id} 旧账单退款失败: ${error.message}`);
      });
    }
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
      const authorizedLimit = await this.resolveAuthorizedLimit(task);
      if (draft.amountMicrocredits > authorizedLimit) {
        await this.lifecycle.fail(task.id, {
          errorCode: TASK_ERROR.generationFailed,
          errorMessage: '新线路价格超出本次请求的授权上限，未继续切换',
          reason: 'generation_failed',
        });
        return false;
      }
      const reserved = await this.billing.reserveTaskBilling({
        userId: task.ownerId,
        taskId: task.id,
        idempotencyKey: `task:${task.id}:run${task.routeRun}:attempt${attemptNumber}`,
        draft,
        chargeLimitMicrocredits: authorizedLimit,
      });
      await this.prisma.generationTask.update({
        where: { id: task.id },
        data: {
          billingOrderId: reserved.order.id,
          authorizedChargeMicrocredits: reserved.reserved,
          creditCost: creditsOf(reserved.reserved),
        },
      });
      return true;
    } catch (error) {
      await this.lifecycle.fail(task.id, {
        errorCode: TASK_ERROR.generationFailed,
        errorMessage: `切换线路时预留积分失败：${(error as Error).message}`,
        reason: 'generation_failed',
      });
      return false;
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
    return old.reservedAmountMicrocredits > 0n ? old.reservedAmountMicrocredits : old.amountMicrocredits;
  }

  // ── 派发 ──────────────────────────────────────────────────────────

  private async dispatch(
    task: GenerationTask,
    attempt: RouteAttempt,
    params: Record<string, any>,
    inputIds: string[],
  ): Promise<StepResult> {
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
        logicalModelId: task.logicalModelId ?? '',
        routeId: attempt.routeId,
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
        return this.switchRoute(task, params, inputIds, routes.map((item) => item.routeId));
      }
      await this.lifecycle.fail(task.id, {
        errorCode: TASK_ERROR.generationFailed,
        errorMessage: (error as Error).message,
        reason: 'generation_failed',
      });
      return 'stop';
    }

    const release = await this.slots.acquire(channel.channelId, channel.concurrencyLimit).catch(() => null);
    if (!release) {
      await this.attempts.markFailed(attempt.id, {
        failureCode: 'channel_unavailable',
        failureMessage: '渠道并发已满，本次未发出请求',
        rejectedNoJob: true,
      });
      const routes = await this.attempts.listRun(task.id, task.routeRun);
      return this.switchRoute(task, params, inputIds, routes.map((item) => item.routeId));
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
    });

    if (outcome.status === 'succeeded' && outcome.result) {
      await this.attempts.markSucceeded(attempt.id, outcome.providerRequestId);
      await this.finalize(task, attempt, outcome.result, channel, params, outcome.providerRequestId);
      return 'stop';
    }
    if (outcome.status === 'pending') {
      await this.attempts.markAccepted(attempt.id, outcome.providerRequestId);
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
      this.recordHealth(outcome.failureCode, attempt);
      const routes = await this.attempts.listRun(task.id, task.routeRun);
      return this.switchRoute(
        task,
        params,
        inputIds,
        routes.map((item) => item.routeId),
      );
    }
    await this.lifecycle.uncertain(
      task.id,
      `上游调用失败（${outcome.failureCode}）：${outcome.failureMessage}`,
    );
    return 'stop';
  }

  // ── 轮询 ──────────────────────────────────────────────────────────

  private async pollOnce(
    task: GenerationTask,
    attempt: RouteAttempt,
    params: Record<string, any>,
    inputIds: string[],
  ): Promise<StepResult> {
    const deadline = task.createdAt.getTime() + (POLL_DEADLINE_MS[modalityOf(task.capability)] ?? POLL_DEADLINE_MS.image);
    if (Date.now() > deadline) {
      await this.lifecycle.uncertain(task.id, '上游长时间未返回结果');
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
        logicalModelId: task.logicalModelId ?? '',
        routeId: attempt.routeId,
        providerModelKey: channel.providerModelKey,
      });
      request = built.request;
    } catch (error) {
      // 已受理任务不能切线：结果可能已经产出
      await this.lifecycle.uncertain(task.id, `轮询前准备失败：${(error as Error).message}`);
      return 'stop';
    }

    const release = await this.slots.acquire(channel.channelId, channel.concurrencyLimit).catch(() => null);
    if (!release) {
      await this.schedulePoll(task, task.providerRequestId ?? '', '等待渠道并发');
      return 'wait';
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
      pollCount: (await this.prisma.apiCallLog.count({ where: { taskId: task.id, requestKind: 'poll' } })) + 1,
      requestBody: result.requestBody,
      responseBody: result.responseBody,
      upstreamUrl: result.upstreamUrl,
    });

    if (outcome.status === 'succeeded' && outcome.result) {
      await this.attempts.markSucceeded(attempt.id, outcome.providerRequestId);
      if (task.billingOrderId) {
        await this.billing.updateProviderRequestId(task.billingOrderId, outcome.providerRequestId);
      }
      await this.finalize(task, attempt, outcome.result, channel, params, outcome.providerRequestId);
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
    await this.lifecycle.uncertain(
      task.id,
      `轮询失败（${outcome.failureCode}）：${outcome.failureMessage}`,
    );
    return 'stop';
  }

  /** 安排下一次回查，并释放执行位（等待期间不占进程） */
  private async schedulePoll(task: GenerationTask, providerRequestId: string, stage: string): Promise<void> {
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

  private recordHealth(failureCode: string, attempt: RouteAttempt): void {
    const retryAfter = failureCode === 'upstream_429' ? 30_000 : undefined;
    this.health.recordFailure(
      failureCode,
      {
        channelId: attempt.channelId,
        channelModelId: attempt.channelModelId,
        routeId: attempt.routeId,
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
      await this.lifecycle.fail(task.id, {
        errorCode: TASK_ERROR.generationFailed,
        errorMessage: '上游返回成功但没有任何产出',
        reason: 'generation_failed',
      });
      return;
    }

    try {
      const outputs = await this.download(references, channel, task.capability, params);
      const stored = await this.media.persist(toMediaRef(task), outputs);
      await this.lifecycle.succeed(
        { id: task.id, ownerId: task.ownerId, billingOrderId: task.billingOrderId, providerRequestId: task.providerRequestId },
        {
          outputAssetIds: stored.map((item) => item.assetId),
          aigcMeta: JSON.stringify(stored[0]?.aigcMeta ?? {}),
          providerRequestId,
          outputDurationMs: outputs[0]?.durationMs ?? undefined,
        },
      );
      void attempt;
    } catch (error) {
      if (TaskMediaService.isLabelError(error)) {
        // fail-closed：未标识的产出绝不交付
        await this.lifecycle.fail(task.id, {
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
      await this.lifecycle.uncertain(taskId, `产出落盘失败且无法暂存：${message}`);
      return;
    }
    this.log.warn(`任务 ${taskId} 产出落盘失败，${MEDIA_RETRY_DELAY_MS / 1000}s 后重试：${message}`);
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
      await this.lifecycle.uncertain(task.id, '暂存的上游结果已损坏，产物状态待核对');
      return;
    }

    const attempt = await this.attempts.latest(task.id, task.routeRun);
    if (!attempt) {
      await this.lifecycle.uncertain(task.id, '找不到产出对应的线路尝试，产物状态待核对');
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
      await this.lifecycle.succeed(
        { id: task.id, ownerId: task.ownerId, billingOrderId: task.billingOrderId, providerRequestId: task.providerRequestId },
        {
          outputAssetIds: stored.map((item) => item.assetId),
          aigcMeta: JSON.stringify(stored[0]?.aigcMeta ?? {}),
          providerRequestId: task.providerRequestId ?? '',
          outputDurationMs: outputs[0]?.durationMs ?? undefined,
        },
      );
    } catch (error) {
      if (TaskMediaService.isLabelError(error)) {
        await this.lifecycle.fail(task.id, {
          errorCode: TASK_ERROR.labelFailed,
          errorMessage: (error as Error).message,
          reason: 'generation_failed',
        });
        return;
      }
      await this.retryOrFail(task, result, retries + 1, (error as Error).message);
    }
  }

  private async retryOrFail(task: GenerationTask, result: ProtocolResult, retries: number, message: string): Promise<void> {
    if (retries >= MAX_MEDIA_RETRIES) {
      // 上游已经成功且计费，只是本地落盘失败；按普通失败退款会造成「双损」
      await this.lifecycle.uncertain(task.id, `产出落盘连续失败 ${retries} 次：${message}`);
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
      if (capability === 'multi_fusion' && !String(format).startsWith('video/') && !String(format).startsWith('audio/')) {
        const normalized = await this.media.normalizeFusionOutput(buffer, format, params.ratio, params.size);
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

/** 只接受完整的 `type/subtype`；缺 subtype 的一律当作未知，交给字节魔数判断 */
function normalizeMediaMime(value: string, kind?: string): string {
  const mime = String(value ?? '').split(';')[0].trim().toLowerCase();
  if (!/^[a-z]+\/[a-z0-9.+-]+$/.test(mime)) return '';
  if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')) return mime;
  return kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mpeg' : '';
}

/** 字节魔数兜底：多家上游返回无扩展名链接，按 URL 猜格式必然出错 */
function inferMediaMime(buffer: Buffer, kind?: string): string {
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  if (buffer.length >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return 'audio/mpeg';
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
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

function safeHostname(): string {
  try {
    return hostname();
  } catch {
    return 'host';
  }
}
