import { describe, expect, it, vi } from 'vitest';

import { ChannelService } from './channel.service';

function channelRow(id: string, sortOrder: number) {
  return {
    id,
    name: `渠道 ${id}`,
    userId: 'system',
    scope: 'system',
    enabled: true,
    sortOrder,
    baseUrl: `https://${id}.example.com`,
    apiKey: 'secret',
    secretKey: 'secret',
    apiFormat: 'openai',
    concurrencyLimit: 10,
    modelsJson: '[]',
    headersJson: '[]',
    proxyUrl: '',
    defaultModelConfigJson: '',
    catalogProviderId: '',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function modelRow(id: string, channelId: string, sortOrder: number, enabled: boolean) {
  return {
    id,
    channelId,
    modelKey: id,
    modelGroupKey: '',
    providerModelKey: id,
    displayName: id,
    channelLabel: '',
    tags: '[]',
    description: '',
    sortOrder,
    icon: '',
    capability: 'image',
    protocol: 'openai-image',
    billingMode: 'fixed_request',
    unitPriceMicrocredits: 1n,
    inputTokenPriceMicrocredits: 0n,
    outputTokenPriceMicrocredits: 0n,
    cachedTokenPriceMicrocredits: 0n,
    priceConfigured: false,
    priceCurrency: 'CREDITS',
    enabled,
    priceVersion: 1,
    capabilityVersion: 1,
    capabilityConfigJson: '',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function createService(rows: ReturnType<typeof channelRow>[], models: ReturnType<typeof modelRow>[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const modelFindMany = vi.fn().mockResolvedValue(models);
  const tierFindMany = vi.fn().mockResolvedValue([]);
  const prisma = {
    modelChannel: {
      count: vi.fn().mockResolvedValue(rows.length),
      findMany,
    },
    channelModel: { findMany: modelFindMany },
    channelModelPriceTier: { findMany: tierFindMany },
    $transaction: vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
  };
  const service = new ChannelService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, modelFindMany, tierFindMany };
}

describe('ChannelService 列表投影', () => {
  it('整页渠道只查一次模型，并按渠道与排序归组', async () => {
    const rows = [channelRow('ch-a', 1), channelRow('ch-b', 2)];
    const models = [
      modelRow('a-first', 'ch-a', 1, true),
      modelRow('a-second', 'ch-a', 2, true),
      modelRow('b-first', 'ch-b', 1, true),
    ];
    const { service, modelFindMany } = createService(rows, models);

    const result = await service.list({ page: 1, limit: 20 });

    expect(modelFindMany).toHaveBeenCalledTimes(1);
    expect(modelFindMany.mock.calls[0][0].where).toMatchObject({
      channelId: { in: ['ch-a', 'ch-b'] },
      deletedAt: null,
    });
    expect(result.channels.map((channel) => channel.id)).toEqual(['ch-a', 'ch-b']);
    expect(result.channels[0].models).toEqual(['a-first', 'a-second']);
    expect(result.channels[1].models).toEqual(['b-first']);
  });

  it('公开目录只投影启用模型，且仍然只查一次', async () => {
    const rows = [channelRow('ch-a', 1), channelRow('ch-b', 2)];
    const models = [
      modelRow('a-enabled', 'ch-a', 1, true),
      modelRow('a-disabled', 'ch-a', 2, false),
      modelRow('b-enabled', 'ch-b', 1, true),
    ];
    const { service, modelFindMany } = createService(rows, models);

    const result = await service.publicSystemChannels();

    expect(modelFindMany).toHaveBeenCalledTimes(1);
    expect(modelFindMany.mock.calls[0][0].where).toMatchObject({ enabled: true });
    expect(result.map((channel) => channel.models)).toEqual([
      ['a-enabled'],
      ['b-enabled'],
    ]);
    expect(result[0].baseUrl).toBe('/api/ai/system/ch-a');
  });

  it('导出渠道时模型与价格档各批量查一次', async () => {
    const rows = [channelRow('ch-a', 1), channelRow('ch-b', 2)];
    const models = [
      modelRow('a-first', 'ch-a', 1, true),
      modelRow('b-first', 'ch-b', 1, true),
    ];
    const { service, modelFindMany, tierFindMany } = createService(rows, models);
    tierFindMany.mockResolvedValue([
      {
        id: 'tier-a',
        channelModelId: 'a-first',
        selectorJson: '{}',
        resolution: '*',
        videoSeconds: 5,
        providerModelKey: 'a-first',
        billingMode: 'fixed_request',
        costConfigured: true,
        costUnitPriceMicrocredits: 10n,
        costInputTokenPriceMicrocredits: 0n,
        costOutputTokenPriceMicrocredits: 0n,
        costCachedTokenPriceMicrocredits: 0n,
        unitPriceMicrocredits: 20n,
        inputTokenPriceMicrocredits: 0n,
        outputTokenPriceMicrocredits: 0n,
        cachedTokenPriceMicrocredits: 0n,
        priceConfigured: true,
        enabled: true,
      },
    ]);

    const result = await service.exportChannels(['ch-a', 'ch-b']);

    expect(modelFindMany).toHaveBeenCalledTimes(1);
    expect(modelFindMany.mock.calls[0][0].where).toMatchObject({
      channelId: { in: ['ch-a', 'ch-b'] },
    });
    expect(tierFindMany).toHaveBeenCalledTimes(1);
    expect(tierFindMany.mock.calls[0][0].where).toMatchObject({
      channelModelId: { in: ['a-first', 'b-first'] },
    });
    expect(result.channels.map((channel) => channel.name)).toEqual(['渠道 ch-a', '渠道 ch-b']);
    expect(result.channels[0].models[0].priceTiers).toHaveLength(1);
  });
});
