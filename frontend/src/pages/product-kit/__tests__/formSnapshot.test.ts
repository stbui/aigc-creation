import { describe, expect, it } from 'vitest';

import { formSnapshotOf } from '../utils';
import type { GalleryItem } from '../hooks';

/**
 * 商品主图「重新生成」的历史回填口径。
 *
 * 左栏表单的字段只读批次首格（同批任务共用一份表单参数），变体张数则按
 * 整批任务的 `variant` 反推 —— 这组用例锁住两条：缺字段不伪造值、
 * 未知变体不计入张数。
 */

function item(over: Partial<GalleryItem> & { id: string }): GalleryItem {
  return { url: '', ...over };
}

describe('formSnapshotOf', () => {
  it('回填表单参数、变体张数与原图素材', () => {
    const snapshot = formSnapshotOf([
      item({
        id: 't1',
        params: {
          batchId: 'b1',
          batchIndex: 1,
          productName: ' 轻奢沙发 ',
          brand: ' 品牌A ',
          platform: 'douyin',
          language: 'zh-CN',
          description: ' 弧形设计 ',
          ratio: '1:1',
          size: '2k',
          variant: 'scene',
        },
        inputAssets: [
          { id: 'asset-1', url: '/uploads/a.png', name: 'a.png' },
          { id: 'asset-2', url: '/uploads/b.png' },
        ],
      }),
      item({ id: 't2', params: { batchId: 'b1', batchIndex: 2, variant: 'scene' } }),
      item({ id: 't3', params: { batchId: 'b1', batchIndex: 3, variant: 'white_background' } }),
    ]);

    expect(snapshot).toEqual({
      productName: '轻奢沙发',
      brand: '品牌A',
      platform: 'douyin',
      language: 'zh-CN',
      description: '弧形设计',
      counts: {
        white_background: 1,
        scene: 2,
        selling_point: 0,
        other: 0,
      },
      ratio: '1:1',
      resolution: '2k',
      images: [
        { id: 'asset-1', url: '/uploads/a.png', name: 'a.png' },
        { id: 'asset-2', url: '/uploads/b.png', name: '原图 2' },
      ],
    });
  });

  it('未知变体不计入张数，缺参数时返回空值与 0', () => {
    const snapshot = formSnapshotOf([
      item({ id: 't1', params: { batchId: 'b1', variant: 'retired_variant' } }),
    ]);

    expect(snapshot).toEqual({
      productName: '',
      brand: '',
      platform: '',
      language: '',
      description: '',
      counts: { white_background: 0, scene: 0, selling_point: 0, other: 0 },
      ratio: '',
      resolution: '',
      images: [],
    });
  });

  it('没有任务格时返回 null', () => {
    expect(formSnapshotOf([])).toBeNull();
  });
});
