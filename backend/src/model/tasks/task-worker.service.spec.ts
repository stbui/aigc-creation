import type { GenerationTask, RouteAttempt } from '../../generated/prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { TaskWorkerService } from './task-worker.service';

function attempt(overrides: Partial<RouteAttempt> = {}): RouteAttempt {
  return {
    id: 'attempt-1',
    taskId: 'task-1',
    routeRun: 1,
    attemptNumber: 1,
    capabilityId: 'free_create',
    modelKey: 'gpt-image-2',
    channelModelId: 'channel-model-1',
    channelId: 'channel-1',
    status: 'selected',
    dispatchState: 'not_sent',
    providerRequestId: null,
    failureCode: null,
    failureMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    ...overrides,
  } as RouteAttempt;
}

function setup() {
  const prisma = {
    $transaction: vi.fn(async (run: (tx: unknown) => unknown) => run(prisma)),
    generationTask: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    billingOrder: { findFirst: vi.fn().mockResolvedValue(null) },
    modelChannel: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ concurrencyLimit: 0 }),
    },
    apiCallLog: { count: vi.fn().mockResolvedValue(0) },
  };
  const attempts = {
    create: vi.fn(),
    listRun: vi.fn(),
    latest: vi.fn(),
    begin: vi.fn(),
    markAccepted: vi.fn(),
    markFailed: vi.fn(),
  };
  const channels = { prepare: vi.fn() };
  const slots = { acquire: vi.fn() };
  const executor = { create: vi.fn(), poll: vi.fn(), logCall: vi.fn() };
  const media = { persist: vi.fn(), discardCreated: vi.fn() };
  const lifecycle = {
    uncertain: vi.fn(),
    fail: vi.fn(),
    succeed: vi.fn(),
    reconcileCancelledTask: vi.fn().mockResolvedValue(false),
  };
  const health = { recordFailure: vi.fn() };
  const queue = {
    enqueue: vi.fn().mockResolvedValue(undefined),
    scheduledTaskIds: vi.fn().mockResolvedValue(new Set()),
    lastReadFailure: null as string | null,
  };
  const worker = new TaskWorkerService(
    prisma as never,
    {} as never,
    {} as never,
    health as never,
    {} as never,
    {} as never,
    channels as never,
    slots as never,
    attempts as never,
    executor as never,
    {} as never,
    media as never,
    {} as never,
    lifecycle as never,
    queue as never,
  );
  return { worker, prisma, attempts, channels, slots, executor, media, lifecycle, health, queue };
}

function task(): GenerationTask {
  return {
    id: 'task-1',
    projectId: 'project-1',
    ownerId: 'user-1',
    status: 'running',
    routeRun: 1,
    params: '{}',
    inputAssetIds: '[]',
    capability: 'free_create',
    modelKey: 'gpt-image-2',
    channelModelId: 'channel-model-1',
    channelId: 'channel-1',
    createdAt: new Date(),
  } as GenerationTask;
}

const routed = {
  capabilityId: 'free_create',
  modelKey: 'gpt-image-2',
  channelModel: { id: 'channel-model-1', channelId: 'channel-1' },
  pricing: {},
} as never;

describe('TaskWorkerService 派发状态机', () => {
  it('队列里已有作业时不重复投递', async () => {
    const { worker, prisma, queue, lifecycle } = setup();
    prisma.generationTask.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'task-1',
        status: 'running',
        routeRun: 1,
        leaseOwner: 'worker-old',
        nextPollAt: null,
      },
    ]);
    queue.scheduledTaskIds.mockResolvedValue(new Set(['task-1']));

    await expect(worker.recoverStaleTasks()).resolves.toBe(0);
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(lifecycle.uncertain).not.toHaveBeenCalled();
  });

  it('队列作业丢失但请求未发出时清掉旧 fencing token 并补投', async () => {
    const { worker, prisma, attempts, queue } = setup();
    prisma.generationTask.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'task-1',
        status: 'running',
        routeRun: 1,
        leaseOwner: 'worker-old',
        nextPollAt: null,
      },
    ]);
    attempts.latest.mockResolvedValue(attempt({ status: 'selected', dispatchState: 'not_sent' }));

    await expect(worker.recoverStaleTasks()).resolves.toBe(1);
    expect(prisma.generationTask.updateMany).toHaveBeenCalledWith({
      where: { id: 'task-1', status: 'running', leaseOwner: 'worker-old' },
      data: { leaseOwner: '', leaseUntil: null, nextPollAt: expect.any(Date) },
    });
    expect(queue.enqueue).toHaveBeenCalledWith('task-1', 0);
  });

  it('结果不明的队列作业丢失后按旧 fencing token 转人工核对', async () => {
    const { worker, prisma, attempts, lifecycle, queue } = setup();
    prisma.generationTask.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'task-1',
        status: 'running',
        routeRun: 1,
        leaseOwner: 'worker-old',
        nextPollAt: null,
      },
    ]);
    attempts.latest.mockResolvedValue(
      attempt({ status: 'dispatching', dispatchState: 'submission_unknown' }),
    );
    lifecycle.uncertain.mockResolvedValue(true);

    await expect(worker.recoverStaleTasks()).resolves.toBe(1);
    expect(lifecycle.uncertain).toHaveBeenCalledWith(
      'task-1',
      expect.stringContaining('可能已经发出'),
      { leaseOwner: 'worker-old' },
    );
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('已受理的队列作业丢失时保留原回查时间，不提前轮询', async () => {
    const { worker, prisma, attempts, queue } = setup();
    const nextPollAt = new Date(Date.now() + 30_000);
    prisma.generationTask.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'task-1',
        status: 'running',
        routeRun: 1,
        leaseOwner: 'worker-old',
        nextPollAt,
      },
    ]);
    attempts.latest.mockResolvedValue(
      attempt({ status: 'dispatching', dispatchState: 'accepted' }),
    );

    await expect(worker.recoverStaleTasks()).resolves.toBe(1);
    expect(prisma.generationTask.updateMany).toHaveBeenCalledWith({
      where: { id: 'task-1', status: 'running', leaseOwner: 'worker-old' },
      data: { leaseOwner: '', leaseUntil: null, nextPollAt },
    });
    const [, delay] = queue.enqueue.mock.calls[0];
    expect(delay).toBeGreaterThan(20_000);
  });

  it('队列作业列表读不到时本轮不补投，并报成失败而非静默成功', async () => {
    const { worker, prisma, queue } = setup();
    prisma.generationTask.findMany.mockResolvedValue([]);
    queue.scheduledTaskIds.mockResolvedValue(null);
    queue.lastReadFailure = '读取队列作业列表 超过 5000ms 未返回（Redis 不可达？）';

    // 读不到队列 ≠ 无事可做：静默返回 0 会让调度器记成一次成功，Redis 停摆无人察觉
    await expect(worker.recoverStaleTasks()).rejects.toThrow(/队列作业列表不可读/);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('队列不可读的失败原因随错误上抛，供后台直接看出是 Redis 停摆', async () => {
    const { worker, prisma, queue } = setup();
    prisma.generationTask.findMany.mockResolvedValue([]);
    queue.scheduledTaskIds.mockResolvedValue(null);
    queue.lastReadFailure = 'connect ECONNREFUSED 127.0.0.1:6379';

    await expect(worker.recoverStaleTasks()).rejects.toThrow(/ECONNREFUSED/);
  });

  it('恢复对账按 id 分页扫描，超过一页的排队任务都能补投', async () => {
    const { worker, prisma, queue } = setup();
    const page = (ids: string[]) =>
      ids.map((id) => ({
        id,
        status: 'queued',
        routeRun: 1,
        leaseOwner: '',
        nextPollAt: null,
      }));
    const firstPage = Array.from({ length: 500 }, (_, index) => `task-${index + 1}`);
    prisma.generationTask.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(page(firstPage))
      .mockResolvedValueOnce(page(['task-501']));
    queue.scheduledTaskIds.mockResolvedValue(new Set());

    await expect(worker.recoverStaleTasks()).resolves.toBe(501);
    expect(prisma.generationTask.findMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: { status: { in: ['queued', 'running'] }, id: { gt: 'task-500' } },
      }),
    );
    expect(queue.enqueue).toHaveBeenCalledTimes(501);
  });

  it('新建 attempt 后回到主循环，先做 begin CAS 再派发', async () => {
    const { worker, prisma, attempts } = setup();
    const current = task();
    (current as any).leaseOwner = (worker as any).owner;
    const selected = attempt();
    const dispatching = attempt({ status: 'dispatching', dispatchState: 'submission_unknown' });

    prisma.generationTask.findUnique.mockResolvedValue(current);
    attempts.create.mockResolvedValue(selected);
    attempts.listRun.mockResolvedValueOnce([]).mockResolvedValueOnce([selected]);
    attempts.begin.mockResolvedValue({ action: 'dispatch', attempt: dispatching });
    vi.spyOn(worker as any, 'resolveRoute').mockResolvedValue(routed);
    const dispatch = vi.spyOn(worker as any, 'dispatch').mockResolvedValue('wait');

    await (worker as any).advance(current);

    expect(attempts.begin).toHaveBeenCalledTimes(1);
    expect(attempts.begin).toHaveBeenCalledWith(selected);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      current,
      dispatching,
      expect.any(Object),
      expect.any(Array),
    );
    expect(attempts.begin.mock.invocationCallOrder[0]).toBeLessThan(
      dispatch.mock.invocationCallOrder[0],
    );
  });

  it('换线建新 attempt 后返回主循环，不直接调用 dispatch', async () => {
    const { worker, prisma, attempts } = setup();
    const current = task();
    (current as any).leaseOwner = (worker as any).owner;
    const oldAttempt = attempt({
      id: 'attempt-old',
      status: 'failed',
      dispatchState: 'rejected_no_job',
    });
    const newAttempt = attempt({ id: 'attempt-new', attemptNumber: 2 });

    vi.spyOn(worker as any, 'resolveRoute').mockResolvedValue(routed);
    attempts.listRun.mockResolvedValue([oldAttempt]);
    vi.spyOn(worker as any, 'replaceBilling').mockResolvedValue(newAttempt);
    prisma.generationTask.findUnique.mockResolvedValue(current);
    const dispatch = vi.spyOn(worker as any, 'dispatch').mockResolvedValue('wait');

    await expect((worker as any).switchRoute(current, {}, [], ['channel-model-old'])).resolves.toBe(
      'continue',
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('首次执行选到不同线路时必须先替换账单，不能直接建 attempt', async () => {
    const { worker, prisma, attempts } = setup();
    const current = task();
    (current as any).leaseOwner = (worker as any).owner;
    (current as any).billingOrderId = 'order-old';
    (current as any).channelModelId = 'channel-model-old';
    prisma.generationTask.findUnique.mockResolvedValue(current);
    attempts.listRun.mockResolvedValue([]);
    vi.spyOn(worker as any, 'resolveRoute').mockResolvedValue(routed);
    const replaceBilling = vi.spyOn(worker as any, 'replaceBilling').mockResolvedValue(null);
    const startAttempt = vi.spyOn(worker as any, 'startAttempt');

    await (worker as any).advance(current);

    expect(replaceBilling).toHaveBeenCalledWith(current, routed, 1);
    expect(startAttempt).not.toHaveBeenCalled();
  });

  it('发送前任务已取消时不得调用上游', async () => {
    const { worker, executor, channels } = setup();
    const dispatching = attempt({ status: 'dispatching', dispatchState: 'submission_unknown' });
    const current = task();
    (current as any).leaseOwner = (worker as any).owner;
    (worker as any).ownsTaskLease = vi.fn().mockResolvedValue(false);

    await expect((worker as any).dispatch(current, dispatching, {}, [])).resolves.toBe('stop');
    expect(channels.prepare).not.toHaveBeenCalled();
    expect(executor.create).not.toHaveBeenCalled();
  });

  it('TCP 建连失败不转人工，按明确未派发自动切换线路', async () => {
    const { worker, attempts, channels, slots, executor, lifecycle } = setup();
    const current = task();
    (current as any).leaseOwner = (worker as any).owner;
    const dispatching = attempt({ status: 'dispatching', dispatchState: 'submission_unknown' });

    channels.prepare.mockResolvedValue({
      channelId: 'channel-1',
      channelName: '测试渠道',
      channelModelId: 'channel-model-1',
      modelKey: 'image-model',
      providerModelKey: 'image-model',
      capability: 'image',
      protocol: 'openai-image',
      concurrencyLimit: 1,
    });
    (worker as any).requests = {
      build: vi.fn().mockResolvedValue({ request: { operation: 'generate' } }),
    };
    slots.acquire.mockResolvedValue(() => undefined);
    executor.create.mockResolvedValue({
      outcome: {
        status: 'failed',
        providerRequestId: '',
        result: null,
        stage: '',
        failureCode: 'outbound_connection_refused',
        failureMessage: '外部服务请求失败：connect ECONNREFUSED 127.0.0.1:3900',
        rejectedNoJob: true,
        statusCode: 0,
        durationMs: 10,
        providerStatus: '',
        latencyMs: 10,
        message: '',
      },
      spec: { method: 'POST', path: '/v1/images/generations', contentType: 'application/json' },
      requestBody: '{}',
      responseBody: '',
      upstreamUrl: 'http://127.0.0.1:3900/v1/images/generations',
    });
    const switchRoute = vi.spyOn(worker as any, 'switchRoute').mockResolvedValue('stop');
    attempts.listRun.mockResolvedValue([dispatching]);

    await expect((worker as any).dispatch(current, dispatching, {}, [])).resolves.toBe('stop');

    expect(attempts.markFailed).toHaveBeenCalledWith(
      'attempt-1',
      expect.objectContaining({ failureCode: 'outbound_connection_refused', rejectedNoJob: true }),
    );
    expect(lifecycle.reconcileCancelledTask).toHaveBeenCalledWith('task-1', 'generation_failed');
    expect(switchRoute).toHaveBeenCalledOnce();
    expect(lifecycle.uncertain).not.toHaveBeenCalled();
  });

  it('上游已受理但 accepted CAS 失败时停止自动轮询并转人工核对', async () => {
    const { worker, attempts, channels, slots, executor, lifecycle } = setup();
    const current = task();
    (current as any).leaseOwner = (worker as any).owner;
    const dispatching = attempt({ status: 'dispatching', dispatchState: 'submission_unknown' });

    channels.prepare.mockResolvedValue({
      channelId: 'channel-1',
      channelName: '测试渠道',
      channelModelId: 'channel-model-1',
      modelKey: 'model-1',
      providerModelKey: 'provider-model-1',
      capability: 'video',
      protocol: 'minimax-video',
      concurrencyLimit: 1,
    });
    (worker as any).requests = {
      build: vi.fn().mockResolvedValue({ request: { operation: 'image_to_video' } }),
    };
    slots.acquire.mockResolvedValue(() => undefined);
    executor.create.mockResolvedValue({
      outcome: {
        status: 'pending',
        providerRequestId: 'upstream-job-1',
        result: null,
        stage: 'pending',
        failureCode: '',
        failureMessage: '',
        rejectedNoJob: false,
        statusCode: 200,
        durationMs: 10,
        providerStatus: 'pending',
        latencyMs: 10,
        message: '',
      },
      spec: { method: 'POST', path: '/v2/video_generation', contentType: 'application/json' },
      requestBody: '{}',
      responseBody: '{}',
      upstreamUrl: 'https://example.test/v2/video_generation',
    });
    attempts.markAccepted.mockResolvedValue(false);

    await expect(
      (worker as any).dispatch(current, dispatching, { duration: '6' }, []),
    ).resolves.toBe('stop');
    expect(lifecycle.uncertain).toHaveBeenCalledWith(
      'task-1',
      expect.stringContaining('上游已受理'),
      { leaseOwner: (worker as any).owner },
    );
  });

  it('轮询从渠道槽位返回后若租约已失去，不调用上游', async () => {
    const { worker, channels, slots, executor } = setup();
    const current = task();
    (current as any).leaseOwner = (worker as any).owner;
    const accepted = attempt({
      status: 'dispatching',
      dispatchState: 'accepted',
      providerRequestId: 'upstream-job-1',
    });

    channels.prepare.mockResolvedValue({
      channelId: 'channel-1',
      channelName: '测试渠道',
      channelModelId: 'channel-model-1',
      modelKey: 'model-1',
      providerModelKey: 'provider-model-1',
      capability: 'video',
      protocol: 'minimax-video',
      concurrencyLimit: 1,
    });
    (worker as any).requests = {
      build: vi.fn().mockResolvedValue({ request: { operation: 'image_to_video' } }),
    };
    const release = vi.fn();
    slots.acquire.mockResolvedValue(release);
    (worker as any).ownsTaskLease = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect((worker as any).pollOnce(current, accepted, {}, [])).resolves.toBe('stop');
    expect(executor.poll).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it('成功 CAS 失败时清理本次新建且未被引用的素材', async () => {
    const { worker, prisma, media, lifecycle } = setup();
    const current = task();
    (current as any).leaseOwner = (worker as any).owner;
    const stored = [
      {
        assetId: 'asset-1',
        buffer: Buffer.from('image'),
        format: 'image/png',
        aigcMeta: { labeled: true, metadata: true, visible: true, method: 'png' },
        created: true,
      },
    ];
    prisma.generationTask.findUnique.mockResolvedValue({
      status: 'running',
      leaseOwner: (worker as any).owner,
    });
    vi.spyOn(worker as any, 'download').mockResolvedValue([
      { buffer: Buffer.from('image'), format: 'image/png', durationMs: null },
    ]);
    media.persist.mockResolvedValue(stored);
    lifecycle.succeed.mockResolvedValue(false);

    await (worker as any).finalize(
      current,
      attempt(),
      { images: [{ url: 'https://example.test/result.png' }] },
      { channelId: 'channel-1' },
      {},
      'upstream-job-1',
    );

    expect(media.discardCreated).toHaveBeenCalledWith('task-1', stored);
  });

  it('上游返回成功但没有任何可解析产出时转人工核对，不自动退款', async () => {
    const { worker, prisma, lifecycle, media } = setup();
    const current = task();
    (current as any).leaseOwner = (worker as any).owner;
    prisma.generationTask.findUnique.mockResolvedValue({
      status: 'running',
      leaseOwner: (worker as any).owner,
    });
    const uncertain = vi.spyOn(worker as any, 'uncertainOwned').mockResolvedValue(undefined);

    await (worker as any).finalize(
      current,
      attempt(),
      { images: [] },
      { channelId: 'channel-1' },
      {},
      'upstream-job-1',
    );

    expect(uncertain).toHaveBeenCalledWith(
      'task-1',
      expect.stringContaining('没有任何可解析的产出'),
    );
    expect(media.persist).not.toHaveBeenCalled();
    expect(lifecycle.fail).not.toHaveBeenCalled();
  });

  it('无线路失败收口必须携带当前执行租约围栏', async () => {
    const { worker, lifecycle } = setup();
    const current = task();
    (worker as any).requests = { maskAssetId: vi.fn().mockReturnValue('') };

    await (worker as any).failNoRoute(current, {});

    expect(lifecycle.fail).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ errorCode: '42204' }),
      { leaseOwner: (worker as any).owner },
    );
  });

  it('建连前失败且没有下一线路时按无线路失败，由生命周期自动退款', async () => {
    const { worker, lifecycle } = setup();
    const current = task();
    (worker as any).requests = { maskAssetId: vi.fn().mockReturnValue('') };
    (worker as any).resolveRoute = vi.fn().mockResolvedValue(null);
    lifecycle.fail.mockResolvedValue(true);

    await expect((worker as any).switchRoute(current, {}, [], ['route-1'])).resolves.toBe('stop');

    expect(lifecycle.fail).toHaveBeenCalledWith(
      'task-1',
      {
        errorCode: '42204',
        errorMessage: '全部可用线路都拒绝或无法承接本次请求',
        reason: 'generation_failed',
      },
      { leaseOwner: (worker as any).owner },
    );
  });
});

describe('TaskWorkerService 业务并发闸门', () => {
  it('用户当前执行数达到套餐并发时，新任务回到 delayed 而不是占住 Worker', async () => {
    const { worker, prisma } = setup();
    const queued = task();
    (queued as any).status = 'queued';
    (queued as any).params = JSON.stringify({ __memberConcurrency: 10 });
    (queued as any).billingOrderId = 'order-1';
    prisma.generationTask.findUnique.mockResolvedValue(queued);
    prisma.generationTask.count.mockResolvedValue(10);

    await expect(worker.processJob('task-1')).resolves.toEqual({
      action: 'delay',
      delayMs: 1_000,
    });
    expect(prisma.generationTask.updateMany).not.toHaveBeenCalled();
  });

  it('渠道并发未满时允许领取任务', async () => {
    const { worker, prisma } = setup();
    const queued = task();
    (queued as any).status = 'queued';
    (queued as any).params = JSON.stringify({ __memberConcurrency: 10 });
    (queued as any).billingOrderId = 'order-1';
    prisma.generationTask.findUnique
      .mockResolvedValueOnce(queued)
      .mockResolvedValueOnce({ status: 'succeeded', nextPollAt: null });
    prisma.generationTask.count.mockImplementation(
      async (args: { where?: { ownerId?: string } }) => (args.where?.ownerId ? 6 : 0),
    );
    prisma.modelChannel.findUnique.mockResolvedValue({ concurrencyLimit: 8 });
    const runClaimed = vi.spyOn(worker as any, 'runClaimed').mockResolvedValue(undefined);

    await expect(worker.processJob('task-1')).resolves.toEqual({ action: 'done' });
    expect(runClaimed).toHaveBeenCalledOnce();
    expect(prisma.generationTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1', status: { in: ['queued', 'running'] } },
        data: expect.objectContaining({
          status: 'running',
          leaseOwner: expect.stringMatching(/^.+:[0-9a-f]{8}$/),
        }),
      }),
    );
  });
});
