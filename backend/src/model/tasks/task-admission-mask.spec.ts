import { describe, expect, it, vi } from 'vitest';

import { TaskAdmissionService } from './task-admission.service';

/**
 * 局部重绘遮罩的准入拒绝路径（docs/testing.md §5.1）。
 *
 * 覆盖两类必须在「扣费之前」失败的边界，避免为注定失败的任务扣积分：
 *   · 遮罩素材本身不合法（不存在 / 非 PNG / 与原图不同尺寸）→ `40001`；
 *   · 任务带了遮罩，但所选线路的能力合同不含 `inputs.mask`（即上游没有
 *     inpainting 端点）→ `42205`。
 *
 * 实现位置：`task-admission.service.ts` 的 `validateMask`（step 7，扣费前）
 * 与 `admit` 的 `42205` 分支（step 9，pricing/预留之前）。两条路径都不会
 * 走到 `billing.reserveBatchBilling`，因此断言「预留不被调用」即钉死
 * 「失败在扣费之前」这一安全不变量（§5.1 提到的「积分退回」在当前实现里
 * 等于不扣费：42205 在 step 9 抛出，比 step 10 计价与 step 13 预留都早）。
 *
 * 采用与 `task-admission.service.spec.ts` 一致的纯 mock / node 环境写法：
 * 不连库、不启 Nest，只验证准入服务的分支语义。
 */

const SOURCE_ID = 'src-1';
const MASK_ID = 'mask-1';

interface SetupOptions {
  /** 遮罩素材查询结果；null 表示查不到（归属/不存在） */
  maskAsset?: { format?: string; width?: number; height?: number } | null;
  /** 原图（输入素材）尺寸，用于同尺寸校验 */
  sourceWidth?: number;
  sourceHeight?: number;
  /** router.resolve 返回的 capabilitySpec 是否声明 mask 输入 */
  resolveReturnsMaskInput?: boolean;
  /** 覆盖默认的局部重绘参数 */
  params?: Record<string, unknown>;
  /** 本次计价金额与用户可用余额（微积分） */
  amountMicrocredits?: bigint;
  availableMicrocredits?: bigint;
}

function setup(opts: SetupOptions = {}) {
  const prisma = {
    generationTask: { findUnique: vi.fn().mockResolvedValue(null) },
    project: {
      findFirst: vi.fn().mockResolvedValue({ id: 'project-1', ownerId: 'user-1' }),
    },
    asset: {
      // 输入素材（原图）：至少 1 张，带尺寸供同尺寸校验
      findMany: vi.fn().mockResolvedValue([
        { id: SOURCE_ID, width: opts.sourceWidth ?? 200, height: opts.sourceHeight ?? 200 },
      ]),
      // 遮罩素材：按用例控制返回值
      findFirst: vi.fn().mockResolvedValue(
        opts.maskAsset === null || opts.maskAsset === undefined
          ? null
          : {
              id: MASK_ID,
              format: opts.maskAsset.format ?? 'image/png',
              width: opts.maskAsset.width ?? 200,
              height: opts.maskAsset.height ?? 200,
            },
      ),
    },
  };
  const membership = {
    perksOf: vi.fn().mockResolvedValue({ fastChannel: false, maxConcurrent: 10, addonDiscountBps: 10000 }),
  };
  const availability = { runtimeOf: vi.fn().mockResolvedValue(undefined) };
  const price = {
    freeCampaignIdOf: vi.fn().mockResolvedValue(undefined),
  };
  const billing = {
    buildDraft: vi.fn().mockReturnValue({
      amountMicrocredits: opts.amountMicrocredits ?? 500n,
      quantity: 1n,
    }),
    availableMicrocreditsOf: vi.fn().mockResolvedValue(opts.availableMicrocredits ?? 1000n),
    reserveBatchBilling: vi.fn(),
  };
  const groups = { accessForUser: vi.fn().mockResolvedValue({}) };
  const promptTools = {
    imageToPrompt: vi.fn().mockResolvedValue({ text: '一张金属材质的参考图' }),
  };
  const router = {
    resolve: vi.fn().mockResolvedValue({
      capabilityId: 'local_redraw',
      modelKey: 'model-lr',
      channelModel: { id: 'cm-1', channelId: 'ch-1' },
      pricing: { configured: true, billingMode: 'fixed_request', unitPriceMicrocredits: 10_000_000 },
      capabilitySpec: {
        inputs: opts.resolveReturnsMaskInput ? { image: {}, mask: {} } : { image: {} },
      },
      intent: { capability: 'image' },
    }),
  };

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

  const dto = {
    projectId: 'project-1',
    capability: 'local_redraw',
    modelKey: 'model-lr',
    inputAssetIds: [SOURCE_ID],
    params: opts.params ?? { region: 'center', prompt: '把背景换成纯白', maskAssetId: MASK_ID },
  };

  return { service, prisma, router, billing, promptTools, dto, maskId: MASK_ID, sourceId: SOURCE_ID };
}

describe('TaskAdmissionService 局部重绘遮罩拒绝路径', () => {
  it('遮罩素材不存在或无权限 → 40001，且不预留积分', async () => {
    const { service, billing, dto } = setup({ maskAsset: null });

    await expect(
      service.admit({ ownerId: 'user-1', dto: dto as never }),
    ).rejects.toMatchObject({ code: 40001 });

    expect(billing.reserveBatchBilling).not.toHaveBeenCalled();
  });

  it('遮罩非 PNG 格式 → 40001，且不预留积分', async () => {
    const { service, billing, dto } = setup({ maskAsset: { format: 'image/jpeg' } });

    await expect(
      service.admit({ ownerId: 'user-1', dto: dto as never }),
    ).rejects.toMatchObject({ code: 40001 });

    expect(billing.reserveBatchBilling).not.toHaveBeenCalled();
  });

  it('遮罩与原图尺寸不一致 → 40001，且不预留积分', async () => {
    const { service, billing, dto } = setup({
      maskAsset: { format: 'image/png', width: 100, height: 100 },
      sourceWidth: 200,
      sourceHeight: 200,
    });

    await expect(service.admit({ ownerId: 'user-1', dto: dto as never })).rejects.toMatchObject({
      code: 40001,
      message: expect.stringContaining('尺寸必须'),
    });

    expect(billing.reserveBatchBilling).not.toHaveBeenCalled();
  });

  it('遮罩存在但线路能力合同不含 mask 输入 → 42205，且不预留积分', async () => {
    // 遮罩合法（PNG、与原图同尺寸），但 resolve 返回的 capabilitySpec 没声明 mask
    const { service, billing, prisma, dto } = setup({
      maskAsset: { format: 'image/png', width: 200, height: 200 },
      resolveReturnsMaskInput: false,
    });

    await expect(
      service.admit({ ownerId: 'user-1', dto: dto as never }),
    ).rejects.toMatchObject({ code: 42205 });

    // 42205 在 step 9 抛出，早于 step 10 计价与 step 13 预留：不得产生任何账单
    expect(billing.buildDraft).not.toHaveBeenCalled();
    expect(billing.reserveBatchBilling).not.toHaveBeenCalled();
    // 遮罩合法性已在 validateMask 通过 → 命中了正确的拒绝分支，而非更早的素材校验
    expect(prisma.asset.findFirst).toHaveBeenCalled();
  });

  it('遮罩合法且线路支持 mask 输入 → 不在此层拒绝（放行到计价）', async () => {
    // 反向用例：确认当线路合同声明 mask 时，准入不再因遮罩而拒绝；
    // 由于没有真实计费/渠道，放行后会因缺少真实预留环境而落到 pricing 之后，
    // 本用例只验证「未抛 40001 / 42205」，把成功路径交给 verify-task-runtime 的 mock 上游。
    const { service, dto } = setup({
      maskAsset: { format: 'image/png', width: 200, height: 200 },
      resolveReturnsMaskInput: true,
    });

    let thrownCode: number | undefined;
    try {
      await service.admit({ ownerId: 'user-1', dto: dto as never });
    } catch (err) {
      thrownCode = (err as { code?: number }).code;
    }
    expect([40001, 42205]).not.toContain(thrownCode);
  });
});

describe('TaskAdmissionService 局部重绘输入与标注坐标', () => {
  const bounds = {
    x: 20,
    y: 30,
    width: 100,
    height: 50,
    sourceWidth: 200,
    sourceHeight: 200,
  };

  it('无遮罩、无描述、无标注 → 40001，且不进入计价或预留', async () => {
    const { service, billing, dto } = setup({
      params: { region: 'center', prompt: '   ' },
    });

    await expect(service.admit({ ownerId: 'user-1', dto: dto as never })).rejects.toMatchObject({
      code: 40001,
      message: expect.stringContaining('至少提交'),
    });

    expect(billing.buildDraft).not.toHaveBeenCalled();
    expect(billing.reserveBatchBilling).not.toHaveBeenCalled();
  });

  it('annotations 直接传数组 → 40001，且不预留积分', async () => {
    const { service, billing, dto } = setup({
      params: {
        region: 'center',
        annotations: [{ instruction: '改成金属材质', bounds }],
      },
    });

    await expect(service.admit({ ownerId: 'user-1', dto: dto as never })).rejects.toMatchObject({
      code: 40001,
    });

    expect(billing.reserveBatchBilling).not.toHaveBeenCalled();
  });

  it('多区域标注缺少坐标 → 40001，且不预留积分', async () => {
    const { service, billing, dto } = setup({
      maskAsset: { format: 'image/png' },
      params: {
        region: 'center',
        maskAssetId: MASK_ID,
        annotations: JSON.stringify([
          { annotationId: '1', label: '标注1', instruction: '改成金属材质', bounds },
          { annotationId: '2', label: '标注2', instruction: '改成哑光玻璃' },
        ]),
      },
    });

    await expect(service.admit({ ownerId: 'user-1', dto: dto as never })).rejects.toMatchObject({
      code: 40001,
      message: expect.stringContaining('每个区域'),
    });

    expect(billing.reserveBatchBilling).not.toHaveBeenCalled();
  });

  it.each([
    ['缺字段', { x: 20, y: 30, width: 100, height: 50 }],
    ['非数字', { ...bounds, x: '20' }],
    ['非有限数', { ...bounds, width: null }],
    ['负数', { ...bounds, x: -1 }],
    ['零宽', { ...bounds, width: 0 }],
    ['越界', { ...bounds, x: 150, width: 100 }],
    ['原图尺寸不一致', { ...bounds, sourceWidth: 100 }],
  ])('坐标%s → 40001，且不预留积分', async (_name, invalidBounds) => {
    const { service, billing, dto } = setup({
      maskAsset: { format: 'image/png' },
      params: {
        region: 'center',
        maskAssetId: MASK_ID,
        annotations: JSON.stringify([
          { annotationId: '1', label: '标注1', instruction: '改成金属材质', bounds: invalidBounds },
        ]),
      },
    });

    await expect(service.admit({ ownerId: 'user-1', dto: dto as never })).rejects.toMatchObject({
      code: 40001,
    });

    expect(billing.reserveBatchBilling).not.toHaveBeenCalled();
  });

  it('有参考图且余额不足时，在解析参考图之前返回 40201', async () => {
    const { service, billing, promptTools, dto } = setup({
      maskAsset: { format: 'image/png' },
      resolveReturnsMaskInput: true,
      params: {
        region: 'center',
        maskAssetId: MASK_ID,
        annotations: JSON.stringify([
          {
            annotationId: '1',
            label: '标注1',
            instruction: '参照这张图改成金属材质',
            referenceAssetId: 'reference-1',
            bounds,
          },
        ]),
      },
      amountMicrocredits: 500n,
      availableMicrocredits: 499n,
    });

    await expect(service.admit({ ownerId: 'user-1', dto: dto as never })).rejects.toMatchObject({
      code: 40201,
    });

    expect(billing.availableMicrocreditsOf).toHaveBeenCalledWith('user-1');
    expect(promptTools.imageToPrompt).not.toHaveBeenCalled();
    expect(billing.reserveBatchBilling).not.toHaveBeenCalled();
  });
});
