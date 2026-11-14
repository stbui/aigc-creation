import { describe, expect, it, vi } from 'vitest';

// 选项集读的是运行时能力目录缓存；单测里固定一份，才能稳定断言「枚举校验」行为。
vi.mock('../../../lib/optionSets', () => ({
  platformOptions: () => [{ value: 'taobao', label: '淘宝' }],
  languageOptions: () => [{ value: 'zh-CN', label: '简体中文' }],
  ratioOptions: () => [{ value: '1:1', label: '1:1' }],
  resolutionOptions: () => [
    { value: '1k', label: '1K' },
    { value: '4k', label: '4K', disabled: true },
  ],
  platformSpec: () => null,
}));

import {
  cloneSnapshotOf,
  downloadExtension,
  splitCloneInputs,
  viralCloneImageInputError,
  viralCloneProductImageLimit,
} from '../utils';
import type { PublicModelGroup } from '../api';
import type { GalleryItem } from '../hooks';

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


function hotRemakeModel(maxImages: number): PublicModelGroup {
  return {
    id: 'hot_remake:hot-remake',
    modelKey: 'hot-remake',
    name: '仿真图像·hot_remake',
    icon: '',
    description: '',
    capability: 'hot_remake',
    sortOrder: 0,
    displayPrice: 10,
    priceLabel: '10 积分',
    billingMode: 'fixed_request',
    capabilitySpec: {
      version: 1,
      capability: 'image',
      inputs: { image: { min: 2, max: maxImages } },
    },
    supplyCount: 1,
    available: true,
  };
}

describe('downloadExtension', () => {
  it('把图片 MIME 类型转换为文件扩展名', () => {
    expect(downloadExtension('image/png')).toBe('png');
    expect(downloadExtension('image/jpeg')).toBe('jpg');
    expect(downloadExtension('image/webp')).toBe('webp');
  });

  it('兼容已有的扩展名写法', () => {
    expect(downloadExtension('png')).toBe('png');
    expect(downloadExtension('.jpg')).toBe('jpg');
  });

  it('缺少或无法识别的格式回退为 png', () => {
    expect(downloadExtension(undefined)).toBe('png');
    expect(downloadExtension('')).toBe('png');
    expect(downloadExtension('application/octet-stream')).toBe('png');
  });
});

describe('cloneSnapshotOf（右栏「重新生成」回填）', () => {
  const baseItem: GalleryItem = {
    id: 'task-1',
    url: '/uploads/generated/task-1/output-1.png',
    params: {
      productName: '蓝色手提包',
      brand: 'LUMI',
      platform: 'taobao',
      language: 'zh-CN',
      requirement: '背景保持简洁',
      degree: 'reference_style',
      ratio: '1:1',
      size: '1k',
    },
    inputAssets: [
      { id: 'asset-product', url: '/uploads/original/product.png', name: 'product.png' },
      { id: 'asset-reference', url: '/uploads/original/reference.png', name: 'reference.png' },
    ],
  };

  it('无参数的历史任务返回 null，不静默回填空表单', () => {
    expect(cloneSnapshotOf({ id: 'old', url: '/x.png' })).toBeNull();
  });

  it('文字参数、复刻程度与有效枚举全部回填', () => {
    const snapshot = cloneSnapshotOf(baseItem);
    expect(snapshot).toMatchObject({
      productName: '蓝色手提包',
      brand: 'LUMI',
      requirement: '背景保持简洁',
      degree: 'reference_style',
      platform: 'taobao',
      language: 'zh-CN',
      ratio: '1:1',
      resolution: '1k',
    });
  });

  it('后端保序 [商品图, 参考图]，素材按 assetId 拆分回填', () => {
    const snapshot = cloneSnapshotOf(baseItem);
    expect(snapshot?.productImages).toEqual([
      { id: 'asset-product', url: '/uploads/original/product.png', name: 'product.png' },
    ]);
    expect(snapshot?.reference).toEqual({
      id: 'asset-reference',
      url: '/uploads/original/reference.png',
      name: 'reference.png',
    });
  });

  it('下架/非法的枚举与禁用的画质档位不回填，保留左栏当前值', () => {
    const snapshot = cloneSnapshotOf({
      ...baseItem,
      params: { ...baseItem.params, platform: 'removed_platform', language: 'xx', ratio: '9:9', size: '4k' },
    });
    expect(snapshot?.platform).toBeUndefined();
    expect(snapshot?.language).toBeUndefined();
    expect(snapshot?.ratio).toBeUndefined();
    expect(snapshot?.resolution).toBeUndefined();
    expect(snapshot?.degree).toBe('reference_style');
  });

  it('只有 inputUrls 没有 assetId 时不伪造素材，交给页面提示重传', () => {
    const snapshot = cloneSnapshotOf({
      ...baseItem,
      inputAssets: undefined,
      inputUrls: ['/product.png', '/reference.png'],
    });
    expect(snapshot?.productImages).toEqual([]);
    expect(snapshot?.reference).toBeNull();
  });
});

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
