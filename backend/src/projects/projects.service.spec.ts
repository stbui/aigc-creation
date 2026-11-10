import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../common/app.exception';
import { ProjectsService } from './projects.service';

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'project-1',
    name: '项目一',
    ownerId: 'user-1',
    deletedAt: null,
    _count: { assets: 0, tasks: 0 },
    ...overrides,
  };
}

describe('ProjectsService', () => {
  it('项目列表只返回未删除项目并带素材/任务计数', async () => {
    const createdAt = new Date('2026-01-02T03:04:05.000Z');
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'project-1',
        name: '项目一',
        ownerId: 'user-1',
        createdAt,
        _count: { assets: 3, tasks: 2 },
      },
    ]);
    const service = new ProjectsService({ project: { findMany } } as never);

    await expect(service.list('user-1')).resolves.toEqual([
      {
        id: 'project-1',
        name: '项目一',
        ownerId: 'user-1',
        createdAt,
        assetCount: 3,
        taskCount: 2,
      },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { ownerId: 'user-1', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { assets: true, tasks: true } } },
    });
  });

  it('新建项目时去掉名称首尾空白', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'project-1' });
    const service = new ProjectsService({ project: { create } } as never);

    await expect(service.create('user-1', '  新项目  ')).resolves.toEqual({ id: 'project-1' });
    expect(create).toHaveBeenCalledWith({ data: { ownerId: 'user-1', name: '新项目' } });
  });

  it('重命名前校验项目归属', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'project-1' });
    const update = vi.fn().mockResolvedValue({ id: 'project-1', name: '改名' });
    const service = new ProjectsService({ project: { findFirst, update } } as never);

    await expect(service.update('user-1', 'project-1', '  改名  ')).resolves.toEqual({
      id: 'project-1',
      name: '改名',
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'project-1', ownerId: 'user-1', deletedAt: null },
      select: { id: true },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { name: '改名' },
    });
  });

  it('重命名不存在或不属于当前用户的项目返回 404', async () => {
    const service = new ProjectsService({
      project: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
    } as never);

    await expect(service.update('user-1', 'missing', '改名')).rejects.toMatchObject({
      code: 40400,
      status: 404,
    });
  });

  it('项目有素材但未指定迁移目标时返回 40901', async () => {
    const findFirst = vi.fn().mockResolvedValue(projectRow({ _count: { assets: 2, tasks: 1 } }));
    const transaction = vi.fn();
    const service = new ProjectsService({ project: { findFirst }, $transaction: transaction } as never);

    const error = await service.remove('user-1', 'project-1').catch((caught) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 40901, status: 409 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('迁移素材后软删除项目，且不按素材状态过滤', async () => {
    const findFirst = vi.fn().mockResolvedValue(projectRow({ _count: { assets: 2, tasks: 4 } }));
    const targetFindFirst = vi.fn().mockResolvedValue({ id: 'project-2' });
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const projectUpdate = vi.fn().mockResolvedValue({});
    const transaction = vi.fn(async (work: (tx: unknown) => unknown) =>
      work({
        project: { findFirst: targetFindFirst, update: projectUpdate },
        asset: { updateMany },
      }),
    );
    const service = new ProjectsService({ project: { findFirst }, $transaction: transaction } as never);

    const result = await service.remove('user-1', 'project-1', 'project-2');

    expect(result).toEqual({ id: 'project-1', deletedAt: expect.any(Date), movedAssets: 2 });
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
  });

  it('迁移目标必须是同 owner 的未删除项目', async () => {
    const findFirst = vi.fn().mockResolvedValue(projectRow({ _count: { assets: 1, tasks: 0 } }));
    const transaction = vi.fn(async (work: (tx: unknown) => unknown) =>
      work({ project: { findFirst: vi.fn().mockResolvedValue(null) } }),
    );
    const service = new ProjectsService({ project: { findFirst }, $transaction: transaction } as never);

    await expect(service.remove('user-1', 'project-1', 'foreign-project')).rejects.toMatchObject({
      code: 40001,
    });
  });

  it('不允许把当前项目作为迁移目标', async () => {
    const findFirst = vi.fn().mockResolvedValue(projectRow({ _count: { assets: 1, tasks: 0 } }));
    const transaction = vi.fn();
    const service = new ProjectsService({ project: { findFirst }, $transaction: transaction } as never);

    await expect(service.remove('user-1', 'project-1', 'project-1')).rejects.toMatchObject({
      code: 40001,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('空项目直接软删除且不迁移素材', async () => {
    const findFirst = vi.fn().mockResolvedValue(projectRow());
    const updateMany = vi.fn();
    const projectUpdate = vi.fn().mockResolvedValue({});
    const transaction = vi.fn(async (work: (tx: unknown) => unknown) =>
      work({ project: { update: projectUpdate }, asset: { updateMany } }),
    );
    const service = new ProjectsService({ project: { findFirst }, $transaction: transaction } as never);

    await expect(service.remove('user-1', 'project-1')).resolves.toMatchObject({ movedAssets: 0 });
    expect(updateMany).not.toHaveBeenCalled();
    expect(projectUpdate).toHaveBeenCalledOnce();
  });

  it('重复删除保持幂等，不重新开启事务', async () => {
    const deletedAt = new Date('2026-01-02T03:04:05.000Z');
    const findFirst = vi.fn().mockResolvedValue(projectRow({ deletedAt }));
    const transaction = vi.fn();
    const service = new ProjectsService({ project: { findFirst }, $transaction: transaction } as never);

    await expect(service.remove('user-1', 'project-1')).resolves.toEqual({
      id: 'project-1',
      deletedAt,
      movedAssets: 0,
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
