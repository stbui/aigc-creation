import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminAssetsService } from './assets-admin.service';

describe('AdminAssetsService 删除顺序', () => {
  let prisma: {
    asset: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    generationTask: { findMany: ReturnType<typeof vi.fn> };
    project: {
      findUnique: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let storage: { get: ReturnType<typeof vi.fn> };
  let provider: { delete: ReturnType<typeof vi.fn> };
  let service: AdminAssetsService;

  beforeEach(() => {
    prisma = {
      asset: { findUnique: vi.fn(), update: vi.fn() },
      generationTask: { findMany: vi.fn() },
      project: {
        findUnique: vi.fn(),
        delete: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn(),
    };
    provider = { delete: vi.fn().mockResolvedValue(undefined) };
    storage = { get: vi.fn(() => provider) };
    service = new AdminAssetsService(prisma as never, storage as never, {} as never);
  });

  it('素材事务失败时不删除对象存储文件', async () => {
    prisma.asset.findUnique.mockResolvedValue({
      id: 'asset-1',
      storageKey: 'uploads/asset-1.png',
      storageBackend: 's3',
    });
    prisma.$transaction.mockRejectedValue(new Error('db failed'));

    await expect(service.remove('asset-1')).rejects.toThrow('db failed');
    expect(storage.get).not.toHaveBeenCalled();
    expect(provider.delete).not.toHaveBeenCalled();
  });

  it('素材事务提交后才删除对象存储文件', async () => {
    prisma.asset.findUnique.mockResolvedValue({
      id: 'asset-1',
      storageKey: 'uploads/asset-1.png',
      storageBackend: 's3',
    });
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) =>
      work({
        generationTask: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'task-1', outputAssetId: 'asset-1', outputAssetIds: '["asset-1"]' },
          ]),
          deleteMany,
        },
        asset: { delete: vi.fn().mockResolvedValue({}) },
      }),
    );

    await expect(service.remove('asset-1')).resolves.toEqual({ id: 'asset-1', removedTasks: 1 });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'task-1' } });
    expect(storage.get).toHaveBeenCalledWith('s3');
    expect(provider.delete).toHaveBeenCalledWith('uploads/asset-1.png');
  });

  it('旧批量状态接口逐条返回成功与失败结果', async () => {
    prisma.asset.findUnique
      .mockResolvedValueOnce({ id: 'asset-1' })
      .mockResolvedValueOnce(null);
    prisma.asset.update.mockResolvedValue({});

    await expect(
      service.setStatusMany(['asset-1', 'asset-missing'], 'hidden'),
    ).resolves.toEqual({
      total: 2,
      succeeded: 1,
      failed: 1,
      count: 1,
      status: 'hidden',
      results: [
        {
          id: 'asset-1',
          ok: true,
          data: { id: 'asset-1', status: 'hidden' },
        },
        {
          id: 'asset-missing',
          ok: false,
          message: '素材不存在',
        },
      ],
    });
    expect(prisma.asset.update).toHaveBeenCalledWith({
      where: { id: 'asset-1' },
      data: { status: 'hidden' },
    });
  });

  it('删除多产出中的首图时保留任务并提升下一张', async () => {
    prisma.asset.findUnique.mockResolvedValue({
      id: 'asset-1',
      storageKey: null,
      storageBackend: 'local',
    });
    const update = vi.fn().mockResolvedValue({});
    const deleteMany = vi.fn();
    prisma.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) =>
      work({
        generationTask: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'task-1',
              outputAssetId: 'asset-1',
              outputAssetIds: '["asset-1","asset-2"]',
            },
          ]),
          update,
          deleteMany,
        },
        asset: { delete: vi.fn().mockResolvedValue({}) },
      }),
    );

    await expect(service.remove('asset-1')).resolves.toEqual({ id: 'asset-1', removedTasks: 0 });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { outputAssetId: 'asset-2', outputAssetIds: '["asset-2"]' },
    });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('删除影响统计包含 JSON 多产出中的非首图', async () => {
    prisma.asset.findUnique.mockResolvedValue({
      id: 'asset-2',
      sizeBytes: 10,
      storageBackend: 'local',
    });
    prisma.generationTask.findMany.mockResolvedValue([
      { id: 'task-1', outputAssetId: 'asset-1', outputAssetIds: '["asset-1","asset-2"]' },
      { id: 'task-2', outputAssetId: 'asset-2', outputAssetIds: '["asset-2"]' },
    ]);

    await expect(service.impact('asset-2')).resolves.toEqual({
      sizeBytes: 10,
      tasks: 2,
      storageBackend: 'local',
    });
  });

  it('硬删项目事务失败时不删除素材文件', async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: 'project-1',
      assets: [
        { id: 'asset-1', storageKey: 'uploads/asset-1.png', storageBackend: 's3' },
      ],
      tasks: [{ id: 'task-1' }],
    });
    const assetQuery = { findMany: vi.fn().mockResolvedValue([{ sizeBytes: 10 }]) };
    (prisma as unknown as { asset: Record<string, unknown> }).asset.findMany = assetQuery.findMany;
    prisma.$transaction.mockRejectedValue(new Error('db failed'));

    await expect(service.removeProject('project-1', true)).rejects.toThrow('db failed');
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('软删项目保留项目行、下架素材并清理任务', async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: 'project-1',
      deletedAt: null,
      assets: [
        { id: 'asset-1', storageKey: 'uploads/asset-1.png', storageBackend: 's3' },
      ],
      tasks: [{ id: 'task-1' }, { id: 'task-2' }],
    });
    (prisma as unknown as {
      asset: { findMany: ReturnType<typeof vi.fn> };
    }).asset.findMany = vi.fn().mockResolvedValue([{ sizeBytes: 10 }]);

    const tx = {
      generationTask: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      asset: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      project: {
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
    };
    prisma.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) => work(tx));

    await expect(service.removeProject('project-1', false)).resolves.toEqual({
      id: 'project-1',
      hard: false,
      impact: { assets: 1, tasks: 2, bytes: 10 },
    });

    expect(tx.generationTask.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'project-1' } });
    expect(tx.asset.updateMany).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      data: { status: 'hidden' },
    });
    expect(tx.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(tx.project.delete).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();
  });
});
