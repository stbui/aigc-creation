import { describe, expect, it } from 'vitest';

import { splitCloneInputs, viralCloneImageInputError, viralCloneProductImageLimit } from '../utils';
import type { PublicLogicalModel } from '../api';

describe('splitCloneInputs', () => {
  it('空输入返回空商品图与空参考图', () => {
    expect(splitCloneInputs(undefined)).toEqual({ productUrls: [], referenceUrl: null });
    expect(splitCloneInputs([])).toEqual({ productUrls: [], referenceUrl: null });
  });

  it('只有一张图时按商品图展示，不误判为参考图', () => {
    expect(splitCloneInputs(['product.png'])).toEqual({
      productUrls: ['product.png'],
      referenceUrl: null,
    });
  });

  it('两张图时拆为一张商品图和一张参考图', () => {
    expect(splitCloneInputs(['product.png', 'reference.png'])).toEqual({
      productUrls: ['product.png'],
      referenceUrl: 'reference.png',
    });
  });

  it('多张商品图时保留全部商品图顺序，末位作为参考图', () => {
    expect(
      splitCloneInputs([
        'product-1.png',
        'product-2.png',
        'product-3.png',
        'product-4.png',
        'product-5.png',
        'reference.png',
      ]),
    ).toEqual({
      productUrls: ['product-1.png', 'product-2.png', 'product-3.png', 'product-4.png', 'product-5.png'],
      referenceUrl: 'reference.png',
    });
  });
});


function hotRemakeModel(maxImages: number): PublicLogicalModel {
  return {
    id: 'model-hot-remake',
    code: 'mock-sim-hot-remake',
    name: '仿真图像·hot_remake',
    icon: '',
    description: '',
    capability: 'hot_remake',
    sortOrder: 0,
    pricePolicy: 'fixed',
    pricingMode: 'fixed',
    displayPrice: 10,
    priceLabel: '10 积分',
    billingMode: 'per_image',
    unitPriceMicrocredits: 10_000_000,
    inputPriceMicrocredits: 0,
    outputPriceMicrocredits: 0,
    cachedPriceMicrocredits: 0,
    priceTiers: [],
    legacyModelIds: [],
    capabilitySpec: {
      version: 1,
      capability: 'image',
      inputs: { image: { min: 2, max: maxImages } },
    },
    capabilityProfiles: [],
    defaultOptions: {},
    available: true,
  };
}

describe('爆款复刻输入数量约束', () => {
  it('为必填参考图预留 1 个模型输入位', () => {
    expect(viralCloneProductImageLimit(4)).toBe(3);
    expect(viralCloneProductImageLimit(null)).toBe(5);
  });

  it('4 张商品图 + 1 张参考图超过模型上限时给出总数提示', () => {
    expect(viralCloneImageInputError(hotRemakeModel(4), 5)).toBe(
      '所选模型「仿真图像·hot_remake」最多支持 4 张输入图片（商品图 + 参考图），当前 5 张，请移除 1 张或切换模型',
    );
  });

  it('总数没有超过模型上限时不报错', () => {
    expect(viralCloneImageInputError(hotRemakeModel(4), 4)).toBeNull();
  });
});
