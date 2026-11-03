import { describe, expect, it, vi } from 'vitest';

import { TaskAdmissionService } from './task-admission.service';

/**
 * 任务准入的素材归属边界。
 *
 * 素材库按账号展示所有项目，项目只用于组织内容；准入必须允许用户使用
 * 自己其他项目中的素材，同时仍然拒绝不属于当前用户的素材。
 */
describe('TaskAdmissionService 输入素材归属', () => {
  function setup(assets: Array<{ id: string }>) {
    const prisma = {
      generationTask: { findUnique: vi.fn().mockResolvedValue(null) },
      project: {
        findUnique: vi.fn().mockResolvedValue({ id: 'project-current', ownerId: 'user-1' }),
      },
      asset: { findMany: vi.fn().mockResolvedValue(assets) },
    };
    const membership = {
      checkConcurrency: vi.fn().mockResolvedValue({ current: 0, limit: 0 }),
      perksOf: vi.fn().mockResolvedValue({ fastChannel: false }),
    };
    const availability = { runtimeOf: vi.fn().mockResolvedValue(undefined) };
    const router = { findModel: vi.fn().mockResolvedValue(null) };
    const service = new TaskAdmissionService(
      prisma as never,
      membership as never,
      availability as never,
      {} as never,
      {} as never,
      router as never,
      {} as never,
      {} as never,
    );

    return { service, prisma };
  }

  it('允许使用当前账号其他项目中的素材', async () => {
    const { service, prisma } = setup([{ id: 'asset-from-another-project' }]);

    await expect(
      service.admit({
        ownerId: 'user-1',
        dto: {
          projectId: 'project-current',
          capability: 'main_image',
          logicalModelId: 'model-1',
          inputAssetIds: ['asset-from-another-project'],
          params: { productName: '测试商品' },
        },
      }),
    ).rejects.toThrow('所选模型不可用，请重新选择');

    expect(prisma.asset.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['asset-from-another-project'] }, ownerId: 'user-1' },
    });
  });

  it('仍然拒绝不存在或不属于当前账号的素材', async () => {
    const { service } = setup([]);

    await expect(
      service.admit({
        ownerId: 'user-1',
        dto: {
          projectId: 'project-current',
          capability: 'main_image',
          logicalModelId: 'model-1',
          inputAssetIds: ['asset-of-another-user'],
          params: { productName: '测试商品' },
        },
      }),
    ).rejects.toThrow('部分输入素材不存在或无权限');
  });
});
