import { describe, expect, it, vi } from 'vitest';

import { TaskLifecycleService } from './task-lifecycle.service';

function setup() {
  const prisma = {
    generationTask: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    routeAttempt: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const billing = {
    settle: vi.fn().mockResolvedValue({}),
    refund: vi.fn().mockResolvedValue({}),
    markUncertain: vi.fn().mockResolvedValue(undefined),
  };
  const service = new TaskLifecycleService(
    prisma as never,
    billing as never,
    { grant: vi.fn() } as never,
    { notify: vi.fn() } as never,
  );
  return { service, prisma, billing };
}

const runningTask = {
  id: 'task-1',
  ownerId: 'user-1',
  status: 'running',
  routeRun: 1,
  billingOrderId: 'order-1',
  creditCost: 10,
  parentTaskId: null,
};

describe('TaskLifecycleService 取消竞态', () => {
  it('先取消任务再回查 attempt；已进入派发态时账单只能转待核对', async () => {
    const { service, prisma, billing } = setup();
    prisma.generationTask.findUnique.mockResolvedValue(runningTask);
    prisma.routeAttempt.findFirst.mockResolvedValue({
      status: 'dispatching',
      dispatchState: 'submission_unknown',
    });

    await expect(service.cancel('task-1', '后台终止')).resolves.toEqual({
      status: 'cancelled',
      billing: 'uncertain',
    });
    expect(prisma.generationTask.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.routeAttempt.findFirst.mock.invocationCallOrder[0],
    );
    expect(billing.markUncertain).toHaveBeenCalledWith('order-1', expect.stringContaining('后台终止'));
    expect(billing.refund).not.toHaveBeenCalled();
  });

  it('确认请求从未离开宿主后才退款', async () => {
    const { service, prisma, billing } = setup();
    prisma.generationTask.findUnique.mockResolvedValue(runningTask);
    prisma.routeAttempt.findFirst.mockResolvedValue({
      status: 'selected',
      dispatchState: 'not_sent',
    });

    await expect(service.cancel('task-1', '后台终止')).resolves.toEqual({
      status: 'cancelled',
      billing: 'refunded',
    });
    expect(billing.refund).toHaveBeenCalledWith('order-1', '后台终止', 'failure');
    expect(billing.markUncertain).not.toHaveBeenCalled();
  });

  it('attempt 已成功但任务尚未收口时终止，仍不得按未派发退款', async () => {
    const { service, prisma, billing } = setup();
    prisma.generationTask.findUnique.mockResolvedValue(runningTask);
    // markSucceeded 会同步写 accepted；这里刻意制造半写状态，验证取消判定
    // 以 attempt 的成功事实为准，而不是只信任派发字段。
    prisma.routeAttempt.findFirst.mockResolvedValue({
      status: 'succeeded',
      dispatchState: 'not_sent',
    });

    await expect(service.cancel('task-1', '后台终止')).resolves.toEqual({
      status: 'cancelled',
      billing: 'uncertain',
    });
    expect(billing.markUncertain).toHaveBeenCalledWith('order-1', expect.stringContaining('后台终止'));
    expect(billing.refund).not.toHaveBeenCalled();
  });
});

describe('TaskLifecycleService 失败退款', () => {
  it('明确未派发的生成失败默认自动退款，不转人工核对', async () => {
    const { service, prisma, billing } = setup();
    prisma.generationTask.findUnique.mockResolvedValue(runningTask);

    await expect(
      service.fail('task-1', {
        errorCode: '42204',
        errorMessage: '建连前网络失败且无下一线路',
        reason: 'generation_failed',
      }),
    ).resolves.toBe(true);

    expect(billing.refund).toHaveBeenCalledWith(
      'order-1',
      '建连前网络失败且无下一线路',
      'failure',
    );
    expect(billing.markUncertain).not.toHaveBeenCalled();
  });
});

describe('TaskLifecycleService 成功结算', () => {
  it('多图融合结算传入实际交付张数', async () => {
    const { service, billing } = setup();

    await expect(
      service.succeed(
        { id: 'task-1', ownerId: 'user-1', billingOrderId: 'order-1', providerRequestId: null },
        { outputAssetIds: ['asset-1'], aigcMeta: '{}' },
      ),
    ).resolves.toBe(true);

    expect(billing.settle).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ deliveredQuantity: 1 }),
    );
  });
});

describe('TaskLifecycleService 取消后的派发结果收敛', () => {
  it('取消时仍可能派发，随后确认请求未到达上游时自动退款', async () => {
    const { service, prisma, billing } = setup();
    prisma.generationTask.findUnique.mockResolvedValue({
      ...runningTask,
      status: 'cancelled',
      parentTaskId: 'parent-1',
    });
    prisma.routeAttempt.findMany.mockResolvedValue([
      { status: 'failed', dispatchState: 'rejected_no_job' },
    ]);

    await expect(service.reconcileCancelledTask('task-1', 'generation_failed')).resolves.toBe(true);

    expect(billing.refund).toHaveBeenCalledWith(
      'order-1',
      '已确认请求未到达上游，取消任务自动退款',
      'failure',
    );
    expect(billing.markUncertain).not.toHaveBeenCalled();
  });

  it('仍有结果不明的派发尝试时不得自动退款', async () => {
    const { service, prisma, billing } = setup();
    prisma.generationTask.findUnique.mockResolvedValue({
      ...runningTask,
      status: 'cancelled',
      parentTaskId: 'parent-1',
    });
    prisma.routeAttempt.findMany.mockResolvedValue([
      { status: 'failed', dispatchState: 'rejected_no_job' },
      { status: 'dispatching', dispatchState: 'submission_unknown' },
    ]);

    await expect(service.reconcileCancelledTask('task-1', 'generation_failed')).resolves.toBe(false);

    expect(billing.refund).not.toHaveBeenCalled();
    expect(billing.markUncertain).not.toHaveBeenCalled();
  });
});

describe('TaskLifecycleService 租约围栏', () => {
  it('成功收口必须校验当前执行租约，租约已变时拒绝结算', async () => {
    const { service, prisma, billing } = setup();
    prisma.generationTask.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.succeed(
        { id: 'task-1', ownerId: 'user-1', billingOrderId: 'order-1', providerRequestId: null },
        { outputAssetIds: ['asset-1'], aigcMeta: '{}' },
        { leaseOwner: 'worker-1' },
      ),
    ).resolves.toBe(false);
    expect(prisma.generationTask.updateMany).toHaveBeenCalledWith({
      where: { id: 'task-1', status: 'running', leaseOwner: 'worker-1' },
      data: expect.objectContaining({ status: 'succeeded' }),
    });
    expect(billing.settle).not.toHaveBeenCalled();
  });

  it('恢复结果不明时按旧 owner 与旧 leaseUntil 精确 CAS', async () => {
    const { service, prisma, billing } = setup();
    const leaseUntil = new Date(1);
    prisma.generationTask.findUnique.mockResolvedValue(runningTask);

    await expect(
      service.uncertain('task-1', '租约过期', { leaseOwner: 'worker-old', leaseUntil }),
    ).resolves.toBe(true);
    expect(prisma.generationTask.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-1',
        status: { in: ['queued', 'running'] },
        leaseOwner: 'worker-old',
        leaseUntil,
      },
      data: expect.objectContaining({ status: 'failed', stage: 'uncertain' }),
    });
    expect(billing.markUncertain).toHaveBeenCalledWith('order-1', '租约过期');
  });

  it('失败收口必须校验当前 owner，租约已变时不得退款', async () => {
    const { service, prisma, billing } = setup();
    prisma.generationTask.findUnique.mockResolvedValue(runningTask);
    prisma.generationTask.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.fail(
        'task-1',
        { errorCode: '42201', errorMessage: '生成失败', reason: 'generation_failed' },
        { leaseOwner: 'worker-old' },
      ),
    ).resolves.toBe(false);

    expect(prisma.generationTask.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-1',
        status: { in: ['queued', 'running'] },
        leaseOwner: 'worker-old',
      },
      data: expect.objectContaining({ status: 'failed' }),
    });
    expect(billing.refund).not.toHaveBeenCalled();
  });
});
