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

/**
 * 商品主图一次提交的「自定义配置」必须完整落到任务与账单。
 *
 * 前端只把计数展开成 `variants=white_background,scene,...`，真正的拆单在
 * 准入服务里完成。这里不复用解析函数的单测，而是走完整 `admit` 分支，锁住：
 *   · N 个变体 → N 个 generationTask；
 *   · 每个任务带正确的 variant / batchIndex / batchSize；
 *   · N 个任务 → N 份账单预留，而不是只预留一次单图价格。
 */
describe('TaskAdmissionService 商品主图自定义配置拆单', () => {
  const VARIANTS = ['white_background', 'scene', 'scene', 'selling_point', 'other', 'other'];
  const UNIT_AMOUNT = 2_000_000n;
  const UNIT_CREDITS = 2;

  function setup() {
    const createdTasks: Array<{ data: Record<string, any> }> = [];
    const updatedTasks: Array<{ where: { id: string }; data: Record<string, any> }> = [];
    let taskSequence = 0;

    const tx = {
      project: {
        findFirst: vi.fn().mockResolvedValue({ id: 'project-1', ownerId: 'user-1' }),
      },
      $executeRaw: vi.fn().mockResolvedValue(1),
      generationTask: {
        create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
          const id = `task-${++taskSequence}`;
          createdTasks.push({ data });
          return { id };
        }),
        update: vi.fn(async (args: { where: { id: string }; data: Record<string, any> }) => {
          updatedTasks.push(args);
          return args.data;
        }),
      },
    };

    const prisma = {
      generationTask: {
        // 本次请求没有幂等键；事务后的首任务回查返回排队态。
        findUnique: vi.fn().mockResolvedValue({ id: 'task-1', status: 'queued', creditCost: UNIT_CREDITS }),
      },
      project: {
        findFirst: vi.fn().mockResolvedValue({ id: 'project-1', ownerId: 'user-1' }),
      },
      asset: {
        findMany: vi.fn().mockResolvedValue([{ id: 'asset-1' }]),
      },
      $transaction: vi.fn(async (run: (client: typeof tx) => Promise<string[]>) => run(tx)),
    };
    const membership = {
      checkConcurrency: vi.fn().mockResolvedValue({ current: 0, limit: 0 }),
      perksOf: vi.fn().mockResolvedValue({ fastChannel: false }),
    };
    const availability = { runtimeOf: vi.fn().mockResolvedValue(undefined) };
    const price = { freeCampaignIdOf: vi.fn().mockResolvedValue(undefined) };
    const billing = {
      buildDraft: vi.fn().mockReturnValue({ amountMicrocredits: UNIT_AMOUNT, quantity: 1n }),
      reserveBatchBilling: vi.fn(
        async (args: {
          items: Array<{ taskId: string; idempotencyKey: string }>;
          draft: { amountMicrocredits: bigint };
        }) =>
          args.items.map((item) => ({
            ...item,
            order: { id: `bill-${item.taskId}` },
            reserved: UNIT_AMOUNT,
          })),
      ),
    };
    const router = {
      resolve: vi.fn().mockResolvedValue({
        capabilityId: 'main_image',
        modelKey: 'model-main-image',
        channelModel: { id: 'cm-1', channelId: 'ch-1' },
        pricing: { configured: true, billingMode: 'fixed_request', unitPriceMicrocredits: UNIT_AMOUNT },
        capabilitySpec: { inputs: { image: {} } },
        intent: { capability: 'image' },
      }),
    };
    const groups = { accessForUser: vi.fn().mockResolvedValue({}) };
    const promptTools = {};

    const service = new TaskAdmissionService(
      prisma as never,
      membership as never,
      availability as never,
      price as never,
      billing as never,
      router as never,
      groups as never,
      promptTools as never,
    );

    return { service, prisma, billing, createdTasks, updatedTasks, membership };
  }

  it('6 张配置创建 6 个独立任务并各预留一份积分', async () => {
    const { service, billing, createdTasks, updatedTasks, membership } = setup();

    const result = await service.admit({
      ownerId: 'user-1',
      dto: {
        projectId: 'project-1',
        capability: 'main_image',
        modelKey: 'model-main-image',
        inputAssetIds: ['asset-1'],
        params: {
          productName: '轻音桌面循环扇',
          description: '三档风速，低噪运行，USB 供电',
          platform: 'taobao',
          language: 'zh-CN',
          ratio: '1:1',
          size: '1k',
          variants: VARIANTS.join(','),
        },
      },
    });

    expect(createdTasks).toHaveLength(VARIANTS.length);
    // 并发按张占位：一次提交 6 张，事务外与事务内两次校验都要带上本次任务数。
    expect(membership.checkConcurrency.mock.calls.map((call) => call[3])).toEqual([
      VARIANTS.length,
      VARIANTS.length,
    ]);
    const taskParams = createdTasks.map(({ data }) => JSON.parse(data.params));
    for (const params of taskParams) {
      expect(params).toMatchObject({
        productName: '轻音桌面循环扇',
        description: '三档风速，低噪运行，USB 供电',
        platform: 'taobao',
        language: 'zh-CN',
        ratio: '1:1',
        size: '1k',
        variants: VARIANTS.join(','),
      });
    }
    expect(taskParams.map((params) => params.variant)).toEqual(VARIANTS);
    expect(taskParams.map((params) => params.variantLabel)).toEqual([
      '白底图',
      '场景图',
      '场景图',
      '卖点图',
      '其他图',
      '其他图',
    ]);
    expect(new Set(taskParams.map((params) => params.batchId)).size).toBe(1);
    expect(taskParams.map((params) => params.batchIndex)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(taskParams.map((params) => params.batchSize)).toEqual([6, 6, 6, 6, 6, 6]);
    expect(createdTasks.every(({ data }) => data.creditCost === UNIT_CREDITS)).toBe(true);
    expect(createdTasks.slice(1).every(({ data }) => data.parentTaskId === 'task-1')).toBe(true);

    expect(billing.reserveBatchBilling).toHaveBeenCalledOnce();
    const reservation = billing.reserveBatchBilling.mock.calls[0][0];
    expect(reservation.items).toHaveLength(VARIANTS.length);
    expect(reservation.items.map((item) => item.taskId)).toEqual([
      'task-1',
      'task-2',
      'task-3',
      'task-4',
      'task-5',
      'task-6',
    ]);
    expect(reservation.draft.amountMicrocredits).toBe(UNIT_AMOUNT);
    expect(updatedTasks).toHaveLength(VARIANTS.length);

    expect(result).toMatchObject({
      taskId: 'task-1',
      status: 'queued',
      creditCost: UNIT_CREDITS * VARIANTS.length,
      idempotentHit: false,
      batchSize: VARIANTS.length,
    });
  });
});
