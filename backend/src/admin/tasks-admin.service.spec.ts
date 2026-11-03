import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../common/app.exception';
import { TasksAdminService } from './tasks-admin.service';

type MockPrisma = {
  generationTask: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};

type MockGenerate = {
  removeTask: ReturnType<typeof vi.fn>;
};

describe('TasksAdminService 删除任务', () => {
  let prisma: MockPrisma;
  let generate: MockGenerate;
  let service: TasksAdminService;

  beforeEach(() => {
    prisma = {
      generationTask: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
    };
    generate = { removeTask: vi.fn() };
    service = new TasksAdminService(prisma as never, generate as never, {} as never);
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
