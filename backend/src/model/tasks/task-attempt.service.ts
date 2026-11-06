/**
 * 线路尝试状态机。
 *
 * 移植自 open-ai-canvas `internal/app/model_router_attempts.go` 的
 * `beginTaskRouteAttempt` / `markRouteAttemptDispatching` / `finishTaskRouteAttempt`。
 *
 * 这张表存在的唯一理由：**判断一次失败到底有没有打到上游**。
 * 「请求没发出去」可以安全换线路重试；「请求可能已经发出」再发一次就可能
 * 让同一个请求在两台上游各扣一次费。四态 `dispatchState` 是这条判断的全部依据，
 * 因此每次派发前必须先做一次 CAS 把 `not_sent` 改成 `submission_unknown` ——
 * CAS 失败说明另一个执行者已经带着这个 attempt 出发，本次必须停下。
 *
 * 只有 `rejected_no_job`（上游明确没有建立任务：渠道槽位失败 / 401 / 403 / 404 / 429）
 * 才允许切线；`submission_unknown` 一律停住等人工或恢复流程。
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma, RouteAttempt } from '@prisma/client';

/** 尝试状态 */
export const ATTEMPT_STATUSES = ['selected', 'dispatching', 'succeeded', 'failed'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/** 派发状态 */
export const DISPATCH_STATES = ['not_sent', 'submission_unknown', 'accepted', 'rejected_no_job'] as const;
export type DispatchState = (typeof DISPATCH_STATES)[number];

/**
 * 失败是否属于「上游明确没有接下这个任务」。
 *
 * 判据只有两类：
 *   · 渠道槽位 / 渠道可用性失败 —— 请求根本没发出去（`channel_unavailable`）；
 *   · 上游以 401 / 403 / 404 / 429 拒绝 —— 请求到了但被拒之门外，没有建立任务。
 *
 * 超时、5xx、连接中断**不在**其中：这些情况下上游可能已经在生成并计费，
 * 换线路重发等于让用户为两次调用付费。宁可停在 `submission_unknown` 等人工。
 */
export function safeRouteRejection(failureCode: string): boolean {
  switch (String(failureCode ?? '').trim()) {
    case 'channel_unavailable':
    case 'upstream_401':
    case 'upstream_403':
    case 'upstream_404':
    case 'upstream_429':
      return true;
    default:
      return false;
  }
}

/** `begin` 的判定结果：本轮该做什么 */
export type AttemptAction = 'dispatch' | 'poll' | 'switch' | 'uncertain' | 'done';

export interface BeginOutcome {
  action: AttemptAction;
  attempt: RouteAttempt;
}

@Injectable()
export class TaskAttemptService {
  constructor(private readonly prisma: PrismaService) {}

  /** 选路成功即建一条 `selected/not_sent` */
  async create(
    input: {
      taskId: string;
      routeRun: number;
      attemptNumber: number;
      logicalModelId: string;
      logicalModelRevisionId: string;
      routeId: string;
      channelModelId: string;
      channelId: string;
    },
    db: Pick<Prisma.TransactionClient, 'routeAttempt'> = this.prisma,
  ): Promise<RouteAttempt> {
    return db.routeAttempt.create({
      data: {
        taskId: input.taskId,
        routeRun: input.routeRun,
        attemptNumber: input.attemptNumber,
        logicalModelId: input.logicalModelId,
        logicalModelRevisionId: input.logicalModelRevisionId,
        routeId: input.routeId,
        channelModelId: input.channelModelId,
        channelId: input.channelId,
        status: 'selected',
        dispatchState: 'not_sent',
      },
    });
  }

  /** 本轮全部尝试（切换线路时用它们的 routeId 组成排除集） */
  async listRun(taskId: string, routeRun: number): Promise<RouteAttempt[]> {
    return this.prisma.routeAttempt.findMany({
      where: { taskId, routeRun },
      orderBy: { attemptNumber: 'asc' },
    });
  }

  /** 本轮最后一次尝试（执行器恢复时读它） */
  async latest(taskId: string, routeRun: number): Promise<RouteAttempt | null> {
    return this.prisma.routeAttempt.findFirst({
      where: { taskId, routeRun },
      orderBy: { attemptNumber: 'desc' },
    });
  }

  /**
   * 决定本轮要做的事，并（需要派发时）完成 CAS。
   *
   * | 当前态 | 结果 |
   * | --- | --- |
   * | `not_sent` | CAS 成 `submission_unknown` + `dispatching`，返回 dispatch |
   * | `submission_unknown` | 结果不明：返回 uncertain，**禁止重发** |
   * | `accepted` | 已建上游任务：返回 poll（带上游任务 id 续轮询） |
   * | `rejected_no_job` | 上游明确没接：返回 switch |
   * | `succeeded` / `failed` | 已终结：返回 done |
   */
  async begin(attempt: RouteAttempt): Promise<BeginOutcome> {
    // 结果不明优先于终态：进程可能在 markFailed 与 lifecycle.uncertain 之间退出。
    // 若只看 status=failed 就换线，会把「可能已打到上游」的请求再发一次。
    if (attempt.dispatchState === 'submission_unknown') {
      return { action: 'uncertain', attempt };
    }
    if (attempt.status === 'succeeded') {
      return { action: 'done', attempt };
    }
    if (attempt.status === 'failed') {
      return attempt.dispatchState === 'rejected_no_job' ? { action: 'done', attempt } : { action: 'uncertain', attempt };
    }
    if (attempt.dispatchState === 'accepted') {
      return { action: 'poll', attempt };
    }
    if (attempt.dispatchState === 'rejected_no_job') {
      return { action: 'switch', attempt };
    }

    // CAS：只有把 not_sent 改成 submission_unknown 的那一次调用可以出发
    const claimed = await this.prisma.routeAttempt.updateMany({
      where: { id: attempt.id, dispatchState: 'not_sent' },
      data: { dispatchState: 'submission_unknown', status: 'dispatching' },
    });
    const current = await this.prisma.routeAttempt.findUnique({ where: { id: attempt.id } });
    if (!current) return { action: 'uncertain', attempt };
    if (claimed.count !== 1) {
      // 别人抢先派发了：结果不明，本次不得重发
      return { action: current.dispatchState === 'accepted' ? 'poll' : 'uncertain', attempt: current };
    }
    return { action: 'dispatch', attempt: current };
  }

  /**
   * 上游已接受：记录上游任务 id，此后失败不再切线。
   *
   * 返回 false 表示 attempt 已不在「正在派发」状态（例如被并发执行者改写），
   * 调用方必须停止并转人工核对，不能把这次响应当成可安全重试的失败。
   */
  async markAccepted(attemptId: string, providerRequestId: string): Promise<boolean> {
    const updated = await this.prisma.routeAttempt.updateMany({
      where: { id: attemptId, status: 'dispatching', dispatchState: 'submission_unknown' },
      data: {
        dispatchState: 'accepted',
        ...(String(providerRequestId ?? '').trim() !== ''
          ? { providerRequestId: String(providerRequestId).trim() }
          : {}),
      },
    });
    if (updated.count === 1) return true;

    // 幂等恢复：并发写已经落到 accepted / succeeded 时，结果同样安全。
    const current = await this.prisma.routeAttempt.findUnique({
      where: { id: attemptId },
      select: { status: true, dispatchState: true },
    });
    return current?.dispatchState === 'accepted' && (current.status === 'dispatching' || current.status === 'succeeded');
  }

  async markSucceeded(attemptId: string, providerRequestId = ''): Promise<void> {
    await this.prisma.routeAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'succeeded',
        dispatchState: 'accepted',
        completedAt: new Date(),
        ...(String(providerRequestId ?? '').trim() !== '' ? { providerRequestId: String(providerRequestId).trim() } : {}),
      },
    });
  }

  /**
   * 记录一次失败。
   *
   * @param failureCode  归一后的失败码（`upstream_401` / `timeout` / …）
   * @param rejectedNoJob 上游是否明确没有接下任务；为真时写入 `rejected_no_job`
   */
  async markFailed(
    attemptId: string,
    input: { failureCode: string; failureMessage: string; rejectedNoJob: boolean; providerRequestId?: string },
  ): Promise<void> {
    await this.prisma.routeAttempt.updateMany({
      where: { id: attemptId },
      data: {
        status: 'failed',
        dispatchState: input.rejectedNoJob ? 'rejected_no_job' : 'submission_unknown',
        failureCode: String(input.failureCode ?? '').slice(0, 120),
        failureMessage: String(input.failureMessage ?? '').slice(0, 1000),
        completedAt: new Date(),
        ...(String(input.providerRequestId ?? '').trim() !== ''
          ? { providerRequestId: String(input.providerRequestId).trim() }
          : {}),
      },
    });
  }
}
