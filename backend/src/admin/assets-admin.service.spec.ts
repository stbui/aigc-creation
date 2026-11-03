import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminAssetsService } from './assets-admin.service';

describe('AdminAssetsService 删除顺序', () => {
  let prisma: {
    asset: { findUnique: ReturnType<typeof vi.fn> };
    project: { findUnique: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let storage: { get: ReturnType<typeof vi.fn> };
  let provider: { delete: ReturnType<typeof vi.fn> };
  let service: AdminAssetsService;

  beforeEach(() => {
    prisma = {
      asset: { findUnique: vi.fn() },
      project: { findUnique: vi.fn() },
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
    prisma.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) =>
      work({
        generationTask: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
        asset: { delete: vi.fn().mockResolvedValue({}) },
      }),
    );

    await expect(service.remove('asset-1')).resolves.toEqual({ id: 'asset-1', removedTasks: 2 });
    expect(storage.get).toHaveBeenCalledWith('s3');
    expect(provider.delete).toHaveBeenCalledWith('uploads/asset-1.png');
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
});
