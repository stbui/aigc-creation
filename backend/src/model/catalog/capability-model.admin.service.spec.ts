import { describe, expect, it, vi } from 'vitest';
import { CapabilityModelAdminService } from './capability-model.admin.service';

const IMAGE_CONFIG = JSON.stringify({
  version: 1,
  image: {
    references: { promptMaxChars: 4000, maxImages: 4, maxImageBytes: 0, maskSupported: false },
    size: { parameter: 'size', values: ['1:1', '16:9'], default: '1:1', allowCustom: false },
    resolution: { supported: true, values: ['1k', '2k'], default: '1k' },
    quality: { supported: false, values: [], default: 'auto' },
    transparentBackground: { supported: false, default: false },
    responseFormat: { supported: true, default: 'url' },
    outputFormat: { supported: false },
    maxOutputs: 1,
  },
});

const validModel = {
  id: 'cm-valid',
  channelId: 'ch-1',
  modelKey: 'image-model',
  modelGroupKey: 'image-model',
  displayName: '可用生图商品',
  icon: '',
  capability: 'image',
  protocol: 'openai-image',
  capabilityConfigJson: IMAGE_CONFIG,
  enabled: true,
  priceConfigured: true,
  deletedAt: null,
};

function serviceWith(prisma: Record<string, unknown>) {
  const catalogVersion = { invalidate: vi.fn() };
  return {
    service: new CapabilityModelAdminService(
      prisma as never,
      catalogVersion as never,
      {} as never,
      {} as never,
    ),
    catalogVersion,
  };
}

describe('CapabilityModelAdminService 失效绑定生命周期', () => {
  it('更新有效绑定不会隐式删除失效绑定', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      capabilityModelBinding: { deleteMany, createMany },
    };
    const prisma = {
      capabilityModelBinding: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            { id: 'b-valid', channelModelId: 'cm-valid' },
            { id: 'b-invalid', channelModelId: 'cm-deleted' },
          ])
          .mockResolvedValueOnce([
            {
              id: 'b-valid-new',
              capabilityId: 'expand',
              channelModelId: 'cm-valid',
              enabled: true,
              priority: 0,
              weight: 80,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
            },
          ]),
      },
      channelModel: {
        findMany: vi.fn().mockResolvedValue([validModel]),
      },
      modelChannel: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'ch-1', name: '主供应商', enabled: true, deletedAt: null },
        ]),
      },
      capabilityPricing: {
        findUnique: vi.fn().mockResolvedValue({ capabilityId: 'expand' }),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const { service, catalogVersion } = serviceWith(prisma);

    await service.replace('expand', [
      { channelModelId: 'cm-valid', enabled: true, priority: 0, weight: 80 },
    ]);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { capabilityId: 'expand', id: { in: ['b-valid'] } },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ capabilityId: 'expand', channelModelId: 'cm-valid', enabled: true, priority: 0, weight: 80 }],
    });
    expect(catalogVersion.invalidate).toHaveBeenCalledOnce();
  });

  it('只有显式 pruneInvalid 才删除商品缺失的绑定', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      capabilityModelBinding: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'b-valid', channelModelId: 'cm-valid' },
          { id: 'b-invalid', channelModelId: 'cm-deleted' },
        ]),
        deleteMany,
      },
      channelModel: {
        findMany: vi.fn().mockResolvedValue([{ id: 'cm-valid' }]),
      },
    };
    const { service, catalogVersion } = serviceWith(prisma);

    await expect(service.pruneInvalid('expand')).resolves.toEqual({ removed: 1 });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { capabilityId: 'expand', id: { in: ['b-invalid'] } },
    });
    expect(catalogVersion.invalidate).toHaveBeenCalledOnce();
  });

  it('pruneAllInvalid 同时清理商品缺失与能力定义不存在的绑定', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const prisma = {
      capabilityModelBinding: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'b-valid', channelModelId: 'cm-valid', capabilityId: 'expand' },
          { id: 'b-missing-model', channelModelId: 'cm-missing', capabilityId: 'expand' },
          { id: 'b-missing-capability', channelModelId: 'cm-valid', capabilityId: 'removed_capability' },
        ]),
        deleteMany,
      },
      channelModel: {
        findMany: vi.fn().mockResolvedValue([{ id: 'cm-valid' }]),
      },
    };
    const { service, catalogVersion } = serviceWith(prisma);

    await expect(service.pruneAllInvalid()).resolves.toEqual({ removed: 2 });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['b-missing-model', 'b-missing-capability'] } },
    });
    expect(catalogVersion.invalidate).toHaveBeenCalledOnce();
  });
});
