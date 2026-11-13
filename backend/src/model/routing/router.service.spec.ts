import { describe, expect, it } from 'vitest';
import { RouterService } from './router.service';

const SPEC = {
  version: 1,
  capability: 'image',
  operations: ['text_to_image'],
  inputs: { image: { min: 0, max: 4 } },
};

function line(id: string, channelModelId: string, channelId: string, priority: number) {
  return {
    id,
    capabilityId: 'image-capability',
    channelModelId,
    enabled: true,
    priority,
    weight: 100,
    channelModel: {
      id: channelModelId,
      channelId,
      channelName: channelId,
      modelKey: 'image-capability',
      modelGroupKey: '',
      providerModelKey: channelModelId,
      displayName: channelModelId,
      icon: '',
      sortOrder: 0,
      enabled: true,
      channelEnabled: true,
      capability: 'image',
      protocol: 'openai-image',
      priceCurrency: 'credits',
      billingMode: 'fixed_request',
      priceConfigured: true,
      priceVersion: 1,
      priceTiers: [],
      capabilitySpec: SPEC,
    },
  };
}

describe('RouterService.simulate', () => {
  it('标记整个最优候选层，而不是只标记层内第一条', async () => {
    const lines = [
      line('binding-a', 'model-a', 'channel-a', 0),
      line('binding-b', 'model-b', 'channel-b', 0),
      line('binding-c', 'model-c', 'channel-c', 100),
    ];
    const capability = {
      id: 'image-capability',
      pricing: {
        capabilityId: 'image-capability',
        billingMode: 'fixed_request',
        unitPriceMicrocredits: 1_000_000,
        inputTokenPriceMicrocredits: 0,
        outputTokenPriceMicrocredits: 0,
        cachedTokenPriceMicrocredits: 0,
        configured: true,
      },
      groups: new Map([
        ['image-capability', { modelKey: 'image-capability', displayName: '图片能力', icon: '', lines }],
      ]),
      orderedGroupKeys: ['image-capability'],
    };
    const catalog = {
      snapshotOrThrow: async () => ({ capabilities: new Map([[capability.id, capability]]) }),
    };
    const scores = {
      tiers: async () => new Map([
        ['model-a', 0],
        ['model-b', 0],
        ['model-c', 1],
      ]),
    };
    const health = { isBlocked: () => false };
    const service = new RouterService(catalog as never, health as never, scores as never);

    const result = await service.simulate(null, capability.id, {
      capability: 'image',
      operation: 'text_to_image',
      inputs: { image: 0 },
      options: {},
    });
    const diagnostics = result.groups[0].lines;

    expect(result.candidates).toBe(2);
    expect(diagnostics.filter((item) => item.selectedTier).map((item) => item.bindingId).sort()).toEqual([
      'binding-a',
      'binding-b',
    ]);
    expect(['model-a', 'model-b']).toContain(result.selectedChannelModelId);
  });
});
