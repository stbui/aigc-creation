import { describe, expect, it } from 'vitest';
import type { AdminChannelView } from '../../../../types/model';
import {
  buildConsumptionIndex,
  buildConsumptionKeyIndex,
  channelConsumptionRefs,
  consumptionImpactText,
  type ConsumptionRow,
  type ProductConsumptionRef,
} from '../useProductConsumption';

function ref(capabilityId: string, capabilityName: string): ProductConsumptionRef {
  return {
    modelKey: `cm-${capabilityId}`,
    modelName: 'seedream-4.0',
    capabilityId,
    capabilityName,
    enabled: true,
    available: true,
  };
}

function row(overrides: Partial<ConsumptionRow> = {}): ConsumptionRow {
  return {
    channelModelId: 'cm-1',
    channelId: 'ch-1',
    modelKey: 'seedream-4.0',
    capabilityId: 'main_image',
    capabilityName: '商品主图',
    ...overrides,
  };
}

describe('buildConsumptionIndex', () => {
  it('按渠道模型反查消费它的能力，并带上能力名', () => {
    const index = buildConsumptionIndex([row()]);
    expect(index.get('cm-1')).toEqual([
      {
        modelKey: 'cm-1',
        modelName: 'seedream-4.0',
        capabilityId: 'main_image',
        capabilityName: '商品主图',
        enabled: true,
        available: true,
      },
    ]);
  });

  it('同一商品被多个能力绑定时全部返回', () => {
    const index = buildConsumptionIndex([
      row(),
      row({ capabilityId: 'poster', capabilityName: '营销海报' }),
    ]);
    expect(index.get('cm-1')?.map((item) => item.capabilityName)).toEqual([
      '商品主图',
      '营销海报',
    ]);
  });
});

describe('buildConsumptionKeyIndex', () => {
  it('按渠道 + 上游模型键反查，供供应商级影响面使用', () => {
    const index = buildConsumptionKeyIndex([row()]);
    expect(index.get('ch-1:seedream-4.0')?.map((item) => item.capabilityName)).toEqual([
      '商品主图',
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
