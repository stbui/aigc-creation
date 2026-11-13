import { describe, expect, it, vi } from 'vitest';

import { TaskAdmissionService } from './task-admission.service';
import { AppError } from '../../common/app.exception';

/**
 * 任务准入的素材归属边界。
 *
 * 素材库按账号展示所有项目，项目只用于组织内容；准入必须允许用户使用
 * 自己其他项目中的素材，同时仍然拒绝不属于当前用户的素材。
 */
describe('TaskAdmissionService 输入素材归属', () => {
  function setup(assets: Array<{ id: string }>, routed: Record<string, unknown> | null = null) {
    const prisma = {
      generationTask: { findUnique: vi.fn().mockResolvedValue(null) },
      project: {
        findFirst: vi.fn().mockResolvedValue({ id: 'project-current', ownerId: 'user-1' }),
      },
      asset: { findMany: vi.fn().mockResolvedValue(assets) },
    };
    const membership = {
      checkConcurrency: vi.fn().mockResolvedValue({ current: 0, limit: 0 }),
      perksOf: vi.fn().mockResolvedValue({ fastChannel: false }),
    };
    const availability = { runtimeOf: vi.fn().mockResolvedValue(undefined) };
    const router = {
      resolve: routed
        ? vi.fn().mockResolvedValue(routed)
        : vi.fn().mockRejectedValue(new AppError(40005, '所选模型不可用，请重新选择', 400)),
    };
    const service = new TaskAdmissionService(
      prisma as never,
      membership as never,
      availability as never,
      {} as never,
      {} as never,
      router as never,
      { accessForUser: vi.fn().mockResolvedValue({}) } as never,
      {} as never,
    );

    return { service, prisma, router };
  }

  it('允许使用当前账号其他项目中的素材', async () => {
    const { service, prisma } = setup([{ id: 'asset-from-another-project' }]);

    await expect(
      service.admit({
        ownerId: 'user-1',
        dto: {
          projectId: 'project-current',
          capability: 'main_image',
          modelKey: 'model-1',
          inputAssetIds: ['asset-from-another-project'],
          params: { productName: '测试商品' },
        },
      }),
    ).rejects.toThrow('所选模型不可用，请重新选择');

    expect(prisma.asset.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['asset-from-another-project'] },
        ownerId: 'user-1',
        status: 'visible',
        project: { deletedAt: null },
      },
    });
    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: 'project-current', deletedAt: null },
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
          modelKey: 'model-1',
          inputAssetIds: ['asset-of-another-user'],
          params: { productName: '测试商品' },
        },
      }),
    ).rejects.toThrow('部分输入素材不存在或无权限');
  });

  it('图片总数超过模型合同时返回准确的输入数量原因', async () => {
    const ids = ['product-1', 'product-2', 'product-3', 'product-4', 'reference'];
    const { service, router } = setup(
      ids.map((id) => ({ id })),
      {
        capabilityId: 'hot_remake',
        modelKey: '仿真图像·hot_remake',
        channelModel: { id: 'cm-1', channelId: 'ch-1' },
        pricing: { configured: true, billingMode: 'fixed_request', unitPriceMicrocredits: 1 },
        capabilitySpec: {
          version: 1,
          capability: 'image',
          inputs: { image: { min: 2, max: 4 } },
        },
        intent: { capability: 'image' },
      },
    );

    await expect(
      service.admit({
        ownerId: 'user-1',
        dto: {
          projectId: 'project-current',
          capability: 'hot_remake',
          modelKey: 'hot-remake',
          inputAssetIds: ids,
          params: {},
        },
      }),
    ).rejects.toThrow(
      '所选模型「仿真图像·hot_remake」仅支持 2-4 张输入图片（当前 5 张），请调整图片数量或更换模型',
    );

    expect(router.resolve).toHaveBeenCalled();
  });
});
