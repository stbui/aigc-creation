import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../common/app.exception';
import { GenerateService } from './generate.service';

const taskViewSelect = {
  id: true,
  projectId: true,
  ownerId: true,
  capability: true,
  status: true,
  inputAssetIds: true,
  params: true,
  parentTaskId: true,
  errorCode: true,
  modelKey: true,
  creditCost: true,
  createdAt: true,
  updatedAt: true,
  outputAssetId: true,
  outputAssetIds: true,
} as const;

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    projectId: 'project-1',
    ownerId: 'user-1',
    capability: 'main_image',
    status: 'succeeded',
    inputAssetIds: '[]',
    outputAssetId: 'asset-hidden-1',
    outputAssetIds: JSON.stringify(['asset-hidden-1', 'asset-visible', 'asset-hidden-2']),
    parentTaskId: null,
    params: '{}',
    errorCode: null,
    modelKey: null,
    creditCost: 10,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:01.000Z'),
    ...overrides,
  };
}

function asset(id: string, status: 'visible' | 'hidden') {
  return {
    id,
    sourceUrl: `/uploads/${id}.png`,
    status,
    aigcMeta: '{}',
    capability: 'main_image',
    width: 100,
    height: 100,
    format: 'image/png',
    durationMs: null,
  };
}

describe('GenerateService 任务读取与重试', () => {
  let prisma: {
    $transaction: ReturnType<typeof vi.fn>;
    generationTask: {
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    billingOrder: { findMany: ReturnType<typeof vi.fn> };
    project: { findFirst: ReturnType<typeof vi.fn> };
    asset: { findMany: ReturnType<typeof vi.fn> };
  };
  let worker: { kick: ReturnType<typeof vi.fn> };
  let signedUrl: { sign: ReturnType<typeof vi.fn> };
  let service: GenerateService;

  beforeEach(() => {
    prisma = {
      $transaction: vi.fn(async (callback: (tx: typeof prisma) => unknown) => callback(prisma)),
      generationTask: {
        findFirst: vi.fn().mockResolvedValue(task()),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({ id: 'task-next' }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      billingOrder: { findMany: vi.fn().mockResolvedValue([]) },
      project: {
        findFirst: vi.fn().mockResolvedValue({ id: 'project-1' }),
      },
      asset: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            asset('asset-hidden-1', 'hidden'),
            asset('asset-visible', 'visible'),
            asset('asset-hidden-2', 'hidden'),
          ]),
      },
    };
    worker = { kick: vi.fn() };
    signedUrl = {
      sign: vi.fn((url: string) => `signed:${url}`),
    };
    service = new GenerateService(
      prisma as never,
      {} as never,
      signedUrl as never,
      {} as never,
      {} as never,
      worker as never,
    );
  });

  it('任务详情只返回仍可见的产出素材', async () => {
    const result = await service.getTask('user-1', 'task-1');

    expect(result.outputAsset).toMatchObject({ id: 'asset-visible' });
    expect(result.outputAssets).toEqual([expect.objectContaining({ id: 'asset-visible' })]);
    expect(JSON.stringify(result)).not.toContain('hidden');
  });

  it('任务详情不下发已下架的输入素材，但保留原始 id 列表', async () => {
    prisma.generationTask.findFirst.mockResolvedValue(
      task({
        inputAssetIds: JSON.stringify(['input-visible', 'input-hidden']),
        outputAssetId: null,
        outputAssetIds: null,
      }),
    );
    prisma.asset.findMany.mockResolvedValue([
      asset('input-visible', 'visible'),
      asset('input-hidden', 'hidden'),
    ]);

    const result = await service.getTask('user-1', 'task-1');

    expect(result.inputAssetIds).toEqual(['input-visible', 'input-hidden']);
    expect(result.inputAssets).toEqual([expect.objectContaining({ id: 'input-visible' })]);
    expect(JSON.stringify(result)).not.toContain('input-hidden.png');
    expect(prisma.asset.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['input-visible', 'input-hidden'] },
        ownerId: 'user-1',
        status: 'visible',
        project: { deletedAt: null },
      },
    });
  });

  it('任务列表按同一口径过滤输入素材', async () => {
    prisma.generationTask.findMany.mockResolvedValue([
      task({
        inputAssetIds: JSON.stringify(['input-visible', 'input-hidden']),
        outputAssetId: null,
        outputAssetIds: null,
      }),
    ]);
    prisma.asset.findMany.mockResolvedValue([
      asset('input-visible', 'visible'),
      asset('input-hidden', 'hidden'),
    ]);

    const result = await service.listTasks('user-1');

    expect(result[0].inputAssets).toEqual([expect.objectContaining({ id: 'input-visible' })]);
    expect(prisma.asset.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['input-visible', 'input-hidden'] },
        ownerId: { in: ['user-1'] },
        status: 'visible',
        project: { deletedAt: null },
      },
    });
  });

  it('作品分页查询排除失败与取消任务，并让总数使用同一条件', async () => {
    prisma.generationTask.findMany.mockResolvedValue([]);
    prisma.generationTask.count.mockResolvedValue(0);

    const result = await service.listTasksPage('user-1', { excludeFailed: true });

    const where = {
      ownerId: 'user-1',
      project: { deletedAt: null },
      status: { notIn: ['failed', 'cancelled'] },
    };
    expect(result.total).toBe(0);
    expect(prisma.generationTask.findMany).toHaveBeenCalledWith({
      where,
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 50,
      select: taskViewSelect,
    });
    expect(prisma.generationTask.count).toHaveBeenCalledWith({ where });
  });

  it('软删项目的任务不能通过详情 id 继续读取', async () => {
    prisma.generationTask.findFirst.mockResolvedValue(null);

    await expect(service.getTask('user-1', 'task-1')).rejects.toBeInstanceOf(AppError);
    expect(prisma.generationTask.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'task-1',
        ownerId: 'user-1',
        project: { deletedAt: null },
      },
      select: taskViewSelect,
    });
  });

  it('重试时在写事务内复核项目未软删', async () => {
    prisma.generationTask.findUnique.mockResolvedValue(
      task({
        status: 'failed',
        modelKey: 'model-1',
        channelModelId: 'channel-model-1',
        channelId: 'channel-1',
        routeRun: 1,
      }),
    );
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(service.retryTask('task-1')).rejects.toBeInstanceOf(AppError);
    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'project-1',
        ownerId: 'user-1',
        deletedAt: null,
      },
      select: { id: true },
    });
    expect(prisma.generationTask.create).not.toHaveBeenCalled();
    expect(worker.kick).not.toHaveBeenCalled();
  });

  it('重试任务创建成功后立即唤醒 worker', async () => {
    prisma.generationTask.findUnique.mockResolvedValue(
      task({
        status: 'failed',
        modelKey: 'model-1',
        channelModelId: 'channel-model-1',
        channelId: 'channel-1',
        routeRun: 1,
      }),
    );
    prisma.generationTask.findFirst.mockResolvedValueOnce(null);

    await expect(service.retryTask('task-1')).resolves.toEqual({
      taskId: 'task-next',
      retriedFromId: 'task-1',
    });
    expect(prisma.generationTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'project-1',
        ownerId: 'user-1',
        retriedFromId: 'task-1',
        retryKey: 'task-retry:task-1',
        routeRun: 2,
      }),
    });
    expect(worker.kick).toHaveBeenCalledOnce();
  });

  it('升级前的重试任务没有 retryKey 时也不重复派生', async () => {
    prisma.generationTask.findUnique.mockResolvedValue(
      task({
        status: 'failed',
        modelKey: 'model-1',
        routeRun: 1,
      }),
    );
    prisma.generationTask.findFirst.mockResolvedValueOnce({ id: 'task-legacy' });

    await expect(service.retryTask('task-1')).resolves.toEqual({
      taskId: 'task-legacy',
      retriedFromId: 'task-1',
    });
    expect(prisma.generationTask.findFirst).toHaveBeenCalledWith({
      where: { retriedFromId: 'task-1' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(prisma.generationTask.create).not.toHaveBeenCalled();
    expect(worker.kick).toHaveBeenCalledOnce();
  });

  it('并发重试触发唯一冲突时返回已创建的重试任务', async () => {
    prisma.generationTask.findUnique
      .mockResolvedValueOnce(
        task({
          status: 'failed',
          modelKey: 'model-1',
          routeRun: 1,
        }),
      )
      .mockResolvedValueOnce({ id: 'task-next' });
    prisma.generationTask.findFirst.mockResolvedValueOnce(null);
    prisma.generationTask.create.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    await expect(service.retryTask('task-1')).resolves.toEqual({
      taskId: 'task-next',
      retriedFromId: 'task-1',
    });
    expect(prisma.generationTask.findUnique).toHaveBeenLastCalledWith({
      where: { retryKey: 'task-retry:task-1' },
      select: { id: true },
    });
    expect(worker.kick).toHaveBeenCalledOnce();
  });

  it('唯一冲突但查不到重试任务时保留原始错误', async () => {
    prisma.generationTask.findUnique
      .mockResolvedValueOnce(
        task({
          status: 'failed',
          modelKey: 'model-1',
          routeRun: 1,
        }),
      )
      .mockResolvedValueOnce(null);
    prisma.generationTask.findFirst.mockResolvedValueOnce(null);
    const conflict = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    });
    prisma.generationTask.create.mockRejectedValueOnce(conflict);

    await expect(service.retryTask('task-1')).rejects.toBe(conflict);
    expect(worker.kick).not.toHaveBeenCalled();
  });
});

describe('GenerateService 删除作品（整批）', () => {
  let prisma: {
    generationTask: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    billingOrder: { findMany: ReturnType<typeof vi.fn> };
    asset: { findMany: ReturnType<typeof vi.fn> };
  };
  let service: GenerateService;

  const batchRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'task-1',
    status: 'failed',
    outputAssetId: null,
    outputAssetIds: null,
    pendingResult: null,
    mediaRecoveryError: null,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      generationTask: {
        findUnique: vi.fn().mockResolvedValue(
          task({
            status: 'failed',
            outputAssetId: null,
            outputAssetIds: null,
          }),
        ),
        findMany: vi.fn().mockResolvedValue([batchRow()]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      billingOrder: { findMany: vi.fn().mockResolvedValue([]) },
      asset: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(prisma)),
    } as never;
    service = new GenerateService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('同批兄弟任务账单待人工核对但已无可交付产出时，整批允许删除', async () => {
    prisma.generationTask.findMany.mockResolvedValue([
      batchRow({ id: 'task-1', status: 'failed' }),
      batchRow({ id: 'task-2', status: 'cancelled' }),
    ]);
    prisma.billingOrder.findMany.mockResolvedValue([
      { status: 'refunded', updatedAt: new Date(), taskId: 'task-1' },
      { status: 'uncertain', updatedAt: new Date(), taskId: 'task-2' },
    ]);

    await expect(service.removeTask('user-1', 'task-1')).resolves.toEqual({
      id: 'task-1',
      removedAsset: false,
    });
    expect(prisma.generationTask.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['task-1', 'task-2'] } },
    });
  });

  it('预授权（reserved）账单失去任务行后永远不可核对，拒绝删除', async () => {
    prisma.billingOrder.findMany.mockResolvedValue([
      { status: 'reserved', updatedAt: new Date(), taskId: 'task-1' },
    ]);

    await expect(service.removeTask('user-1', 'task-1')).rejects.toMatchObject({
      code: 40901,
    });
    expect(prisma.generationTask.deleteMany).not.toHaveBeenCalled();
  });

  it('账单待核对但任务仍持有产出素材时拒绝删除，避免抹掉交付证据', async () => {
    prisma.generationTask.findMany.mockResolvedValue([
      batchRow({ id: 'task-1', status: 'succeeded', outputAssetId: 'asset-1' }),
    ]);
    prisma.billingOrder.findMany.mockResolvedValue([
      { status: 'uncertain', updatedAt: new Date(), taskId: 'task-1' },
    ]);

    await expect(service.removeTask('user-1', 'task-1')).rejects.toMatchObject({
      code: 40901,
    });
    expect(prisma.generationTask.deleteMany).not.toHaveBeenCalled();
  });
});
