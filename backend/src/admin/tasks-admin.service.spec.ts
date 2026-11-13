import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../common/app.exception';
import { TasksAdminService } from './tasks-admin.service';

type MockPrisma = {
  generationTask: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  asset: {
    findMany: ReturnType<typeof vi.fn>;
  };
  routeAttempt: {
    findMany: ReturnType<typeof vi.fn>;
  };
};

type MockGenerate = {
  removeTask: ReturnType<typeof vi.fn>;
};

describe('TasksAdminService 删除任务', () => {
  let prisma: MockPrisma;
  let generate: MockGenerate;
  let signedUrl: { displayUrl: ReturnType<typeof vi.fn> };
  let service: TasksAdminService;

  beforeEach(() => {
    prisma = {
      generationTask: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      asset: { findMany: vi.fn().mockResolvedValue([]) },
      routeAttempt: { findMany: vi.fn().mockResolvedValue([]) },
    };
    generate = { removeTask: vi.fn() };
    signedUrl = { displayUrl: vi.fn((url: string) => url) };
    service = new TasksAdminService(prisma as never, generate as never, signedUrl as never);
  });

  it('已结束任务复用用户端清理逻辑', async () => {
    prisma.generationTask.findUnique.mockResolvedValue({ ownerId: 'user-1' });
    prisma.generationTask.findMany.mockResolvedValue([{ status: 'succeeded' }]);
    generate.removeTask.mockResolvedValue({ id: 'task-1', removedAsset: true });

    await expect(service.remove('task-1')).resolves.toEqual({
      id: 'task-1',
      removedAsset: true,
    });
    expect(generate.removeTask).toHaveBeenCalledWith('user-1', 'task-1');
  });

  it('排队中或执行中的任务必须先终止', async () => {
    prisma.generationTask.findUnique.mockResolvedValue({ ownerId: 'user-1' });
    prisma.generationTask.findMany.mockResolvedValue([{ status: 'running' }]);

    await expect(service.remove('task-1')).rejects.toBeInstanceOf(AppError);
    expect(generate.removeTask).not.toHaveBeenCalled();
  });

  it('批量删除逐条执行并保留失败原因', async () => {
    prisma.generationTask.findUnique.mockResolvedValue({ ownerId: 'user-1' });
    prisma.generationTask.findMany.mockResolvedValue([{ status: 'failed' }]);
    generate.removeTask
      .mockResolvedValueOnce({ id: 'task-1', removedAsset: false })
      .mockRejectedValueOnce(new AppError(40000, '任务不存在', 404));

    const summary = await service.batchAction(['task-1', 'task-2'], 'delete');

    expect(summary).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(summary.results[1]).toMatchObject({ id: 'task-2', ok: false });
  });
});

describe('TasksAdminService 任务详情全链路', () => {
  let prisma: MockPrisma;
  let signedUrl: { displayUrl: ReturnType<typeof vi.fn> };
  let service: TasksAdminService;

  const task = {
    id: 'task-1',
    capability: 'main_image',
    status: 'failed',
    errorCode: '42204',
    creditCost: 10,
    retriedFromId: 'task-0',
    inputAssetIds: '[]',
    params: '{}',
    createdAt: new Date('2026-11-05T10:00:00.000Z'),
    updatedAt: new Date('2026-11-05T10:00:02.000Z'),
    owner: { id: 'user-1', email: 'owner@example.com' },
    project: { id: 'project-1', name: '默认项目' },
    outputAsset: null,
  };

  beforeEach(() => {
    prisma = {
      generationTask: {
        findUnique: vi.fn().mockResolvedValue(task),
        findMany: vi.fn(),
      },
      asset: { findMany: vi.fn().mockResolvedValue([]) },
      routeAttempt: { findMany: vi.fn().mockResolvedValue([]) },
    };
    signedUrl = { displayUrl: vi.fn((url: string) => `signed:${url}`) };
    service = new TasksAdminService(prisma as never, {} as never, signedUrl as never);
  });

  it('按 routeRun / attemptNumber 返回线路尝试，并保持 task.read 与账单权限边界', async () => {
    prisma.routeAttempt.findMany.mockResolvedValue([
      {
        id: 'attempt-1',
        routeRun: 1,
        attemptNumber: 1,
        capabilityId: 'free_create',
        modelKey: 'gpt-image-2',
        channelId: 'channel-1',
        channelModelId: 'channel-model-1',
        status: 'failed',
        dispatchState: 'rejected_no_job',
        providerRequestId: '',
        failureCode: 'outbound_connection_refused',
        failureMessage: 'connect ECONNREFUSED 127.0.0.1:3900',
        startedAt: new Date('2026-11-05T10:00:00.100Z'),
        completedAt: new Date('2026-11-05T10:00:01.100Z'),
      },
    ]);

    const detail = await service.detail('task-1');

    expect(prisma.routeAttempt.findMany).toHaveBeenCalledWith({
      where: { taskId: 'task-1' },
      orderBy: [{ routeRun: 'asc' }, { attemptNumber: 'asc' }],
    });
    expect(detail.routeAttempts).toEqual([
      expect.objectContaining({
        id: 'attempt-1',
        routeRun: 1,
        attemptNumber: 1,
        dispatchState: 'rejected_no_job',
        failureCode: 'outbound_connection_refused',
      }),
    ]);
    expect(detail).not.toHaveProperty('billingOrders');
  });

  it('无线路尝试时返回空数组', async () => {
    const detail = await service.detail('task-1');

    expect(detail.routeAttempts).toEqual([]);
  });

  it('任务不存在时不查询线路尝试', async () => {
    prisma.generationTask.findUnique.mockResolvedValue(null);

    await expect(service.detail('missing')).rejects.toBeInstanceOf(AppError);
    expect(prisma.routeAttempt.findMany).not.toHaveBeenCalled();
  });
});
