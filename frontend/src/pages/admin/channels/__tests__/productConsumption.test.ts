import { describe, expect, it } from 'vitest';
import type { AdminChannelView, AdminLogicalModelView } from '../../../../types/model';
import {
  buildConsumptionIndex,
  buildConsumptionKeyIndex,
  channelConsumptionRefs,
  consumptionImpactText,
  type ProductConsumptionRef,
} from '../useProductConsumption';

function ref(capabilityId: string, capabilityName: string): ProductConsumptionRef {
  return {
    logicalModelId: `lm-${capabilityId}`,
    modelName: `${capabilityName}售卖配置`,
    capabilityId,
    capabilityName,
    enabled: true,
    available: true,
  };
}

function model(overrides: Partial<AdminLogicalModelView> = {}): AdminLogicalModelView {
  return {
    id: 'lm-1',
    code: 'main-image-pro',
    name: '电商主图 Pro',
    icon: '',
    description: '',
    capability: 'main_image',
    sortOrder: 0,
    pricePolicy: 'channel',
    pricingMode: 'per_request',
    displayPrice: 10,
    priceLabel: '',
    billingMode: 'fixed_request',
    unitPriceMicrocredits: 0,
    inputPriceMicrocredits: 0,
    outputPriceMicrocredits: 0,
    cachedPriceMicrocredits: 0,
    priceTiers: [],
    legacyModelIds: [],
    capabilitySpec: { version: 1, capability: 'image', operations: [] },
    capabilityProfiles: [],
    defaultOptions: {},
    available: true,
    enabled: true,
    activeRevisionId: 'rev-1',
    revisionVersion: 1,
    configurationError: '',
    availabilityError: '',
    archivedAt: null,
    routes: [
      {
        id: 'route-1',
        channelModelId: 'cm-1',
        channelId: 'ch-1',
        channelName: '火山方舟',
        channelModelKey: 'seedream-4.0',
        channelModelName: '即梦 4.0',
        enabled: true,
        priority: 100,
        weight: 100,
        structurallyAvailable: true,
        available: true,
        capabilitySpec: { version: 1, capability: 'image', operations: [] },
      },
    ],
    ...overrides,
  };
}

describe('buildConsumptionIndex', () => {
  it('按渠道模型反查消费它的能力，并带上能力名', () => {
    const index = buildConsumptionIndex(
      [model()],
      new Map([['main_image', '商品主图']]),
    );

    expect(index.get('cm-1')).toEqual([
      {
        logicalModelId: 'lm-1',
        modelName: '电商主图 Pro',
        capabilityId: 'main_image',
        capabilityName: '商品主图',
        enabled: true,
        available: true,
      },
    ]);
  });

  it('归档的前台模型不参与消费关系', () => {
    const index = buildConsumptionIndex(
      [model({ archivedAt: '2026-01-01T00:00:00.000Z' })],
      new Map(),
    );

    expect(index.size).toBe(0);
  });

  it('缺少能力名时回落能力 id，多个模型可同时消费同一商品', () => {
    const index = buildConsumptionIndex(
      [
        model(),
        model({
          id: 'lm-2',
          name: '电商主图 Lite',
          capability: 'main_image',
          routes: [
            {
              ...model().routes[0],
              id: 'route-2',
              channelModelId: 'cm-1',
            },
          ],
        }),
      ],
      new Map(),
    );

    expect(index.get('cm-1')?.map((ref) => ref.capabilityName)).toEqual([
      'main_image',
      'main_image',
    ]);
  });
});

describe('buildConsumptionKeyIndex', () => {
  it('按渠道 + 上游模型键反查，供供应商级影响面使用', () => {
    const index = buildConsumptionKeyIndex(
      [model()],
      new Map([['main_image', '商品主图']]),
    );

    expect(index.get('ch-1:seedream-4.0')).toEqual([
      {
        logicalModelId: 'lm-1',
        modelName: '电商主图 Pro',
        capabilityId: 'main_image',
        capabilityName: '商品主图',
        enabled: true,
        available: true,
      },
    ]);
  });
});

describe('channelConsumptionRefs', () => {
  it('只按在售商品汇总供应商影响面', () => {
    const byModelKey = new Map([
      ['ch-1:seedream-4.0', [ref('main_image', '商品主图')]],
      ['ch-1:other', [ref('poster', '营销海报')]],
    ]);
    const channel = {
      id: 'ch-1',
      modelCosts: [{ model: 'seedream-4.0' }],
    } as unknown as Pick<AdminChannelView, 'id' | 'modelCosts'>;

    expect(channelConsumptionRefs(channel, byModelKey)).toHaveLength(1);
    expect(channelConsumptionRefs(channel, byModelKey)[0].capabilityName).toBe('商品主图');
  });
});

describe('consumptionImpactText', () => {
  it('没有消费方时明确说明，而不是空白', () => {
    expect(consumptionImpactText([])).toBe('当前没有被任何能力消费');
  });

  it('同一能力只报一次，最多列三个名字', () => {
    expect(
      consumptionImpactText([
        ref('main_image', '商品主图'),
        ref('main_image', '商品主图'),
        ref('poster', '营销海报'),
      ]),
    ).toBe('影响 2 个能力（商品主图、营销海报）');
  });
});
