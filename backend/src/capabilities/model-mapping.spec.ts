import { describe, expect, it } from 'vitest';
import { editImageIntent } from './model-mapping';

describe('editImageIntent', () => {
  it.each([
    ['maskAssetId', { maskAssetId: 'asset-mask' }],
    ['modelGuideAssetId', { modelGuideAssetId: 'asset-guide' }],
  ])('把 %s 映射为路由意图中的 mask 输入', (_key, params) => {
    expect(editImageIntent(params, { image: 1, video: 0 })).toEqual({
      capability: 'image',
      operation: 'image_to_image',
      inputs: { image: 1, mask: 1 },
      options: {},
    });
  });

  it('没有遮罩时不声明 mask 输入', () => {
    expect(editImageIntent({}, { image: 1, video: 0 })).toEqual({
      capability: 'image',
      operation: 'image_to_image',
      inputs: { image: 1 },
      options: {},
    });
  });
});
