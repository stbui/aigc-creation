import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseCsv } from '../common/csv';
import { AdminAssetsService } from './assets-admin.service';

describe('AdminAssetsService 删除顺序', () => {
  let prisma: {
    asset: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    generationTask: { findMany: ReturnType<typeof vi.fn> };
    project: {
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    user: { findUnique: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let storage: { get: ReturnType<typeof vi.fn> };
  let provider: { delete: ReturnType<typeof vi.fn> };
  let service: AdminAssetsService;

  beforeEach(() => {
    prisma = {
      asset: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
      generationTask: { findMany: vi.fn() },
      project: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
        update: vi.fn(),
      },
      user: { findUnique: vi.fn() },
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

  it('后台项目列表返回所属用户与素材/任务计数', async () => {
    const createdAt = new Date('2026-01-02T03:04:05.000Z');
    prisma.project.findMany.mockResolvedValue([
      {
        id: 'project-1',
        name: '项目一',
        ownerId: 'user-1',
        owner: { id: 'user-1', email: 'user@example.com', name: '用户一' },
        createdAt,
        _count: { assets: 3, tasks: 2 },
      },
    ]);
    prisma.project.count.mockResolvedValue(1);

    await expect(service.listProjects({ page: 1, pageSize: 20 })).resolves.toEqual({
      items: [
        {
          id: 'project-1',
          name: '项目一',
          ownerId: 'user-1',
          ownerEmail: 'user@example.com',
          ownerName: '用户一',
          assetCount: 3,
          taskCount: 2,
          createdAt,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it('后台新建项目校验所属用户状态并去掉名称空白', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', status: 'active' });
    prisma.project.create.mockResolvedValue({ id: 'project-1' });

    await expect(service.createProject('  新项目  ', 'user-1')).resolves.toEqual({
      id: 'project-1',
    });
    expect(prisma.project.create).toHaveBeenCalledWith({
      data: { name: '新项目', ownerId: 'user-1' },
    });
  });

  it('后台新建项目拒绝不存在或已禁用用户', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', status: 'disabled' });

    await expect(service.createProject('新项目', 'user-1')).rejects.toMatchObject({ code: 40001 });
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it('后台重命名项目只更新名称', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.project.update.mockResolvedValue({ id: 'project-1', name: '改名' });

    await expect(service.updateProject('project-1', '  改名  ')).resolves.toEqual({
      id: 'project-1',
      name: '改名',
    });
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { name: '改名' },
    });
  });

  it('项目有素材但未指定迁移目标时返回 40901', async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: 'project-1',
      ownerId: 'user-1',
      deletedAt: null,
      _count: { assets: 1, tasks: 2 },
    });

    await expect(service.removeProject('project-1')).rejects.toMatchObject({ code: 40901 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('项目删除迁移素材后只写 deletedAt，不删除任务或文件', async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: 'project-1',
      ownerId: 'user-1',
      deletedAt: null,
      _count: { assets: 2, tasks: 3 },
    });
    const targetFindFirst = vi.fn().mockResolvedValue({ id: 'project-2' });
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const projectUpdate = vi.fn().mockResolvedValue({});
    prisma.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) =>
      work({
        project: { findFirst: targetFindFirst, update: projectUpdate },
        asset: { updateMany },
      }),
    );

    await expect(service.removeProject('project-1', 'project-2')).resolves.toEqual({
      id: 'project-1',
      hard: false,
      deprecatedHard: true,
      deletedAt: expect.any(Date),
      movedAssets: 2,
      retained: { assets: 0, tasks: 3 },
    });
    expect(targetFindFirst).toHaveBeenCalledWith({
      where: { id: 'project-2', ownerId: 'user-1', deletedAt: null },
      select: { id: true },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { projectId: 'project-1', ownerId: 'user-1' },
      data: { projectId: 'project-2' },
    });
    expect(projectUpdate).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(prisma.generationTask.findMany).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('空项目删除直接软删除，不要求迁移目标', async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: 'project-1',
      ownerId: 'user-1',
      deletedAt: null,
      _count: { assets: 0, tasks: 2 },
    });
    const projectUpdate = vi.fn().mockResolvedValue({});
    prisma.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) =>
      work({ project: { update: projectUpdate }, asset: { updateMany: vi.fn() } }),
    );

    await expect(service.removeProject('project-1')).resolves.toMatchObject({
      movedAssets: 0,
      retained: { assets: 0, tasks: 2 },
    });
    expect(projectUpdate).toHaveBeenCalledOnce();
  });

  it('重复删除项目幂等返回首次删除时间', async () => {
    const deletedAt = new Date('2026-01-02T03:04:05.000Z');
    prisma.project.findUnique.mockResolvedValue({
      id: 'project-1',
      ownerId: 'user-1',
      deletedAt,
      _count: { assets: 0, tasks: 4 },
    });

    await expect(service.removeProject('project-1')).resolves.toEqual({
      id: 'project-1',
      hard: false,
      deprecatedHard: true,
      deletedAt,
      movedAssets: 0,
      retained: { assets: 0, tasks: 4 },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('素材 CSV 表头字段唯一且顺序稳定', async () => {
    prisma.asset.findMany.mockResolvedValue([]);
    const displayUrl = vi.fn((url: string) => `signed:${url}`);
    service = new AdminAssetsService(prisma as never, storage as never, { displayUrl } as never);

    const csv = await service.exportCsv({});
    const header = parseCsv(csv)[0];

    expect(header).toEqual([
      '素材 ID',
      '类型',
      '能力',
      '状态',
      '宽',
      '高',
      '格式',
      '大小(字节)',
      '存储后端',
      '存储键',
      '用户',
      '项目',
      '地址',
      '创建时间',
    ]);
    expect(new Set(header).size).toBe(header.length);
    expect(displayUrl).not.toHaveBeenCalled();
  });
});
