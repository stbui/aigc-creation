import { describe, expect, it } from 'vitest';
import { defaultCapabilitySpecFor } from './utils';

describe('defaultCapabilitySpecFor', () => {
  it('带参考图的图片生成能力同时支持文生图与图生图', () => {
    expect(
      defaultCapabilitySpecFor({
        modality: 'image',
        inputs: 1,
        model: { capability: 'image', operation: 'text_to_image' },
      }),
    ).toEqual({
      version: 1,
      capability: 'image',
      operations: ['text_to_image', 'image_to_image'],
    });
  });

  it('图片编辑能力只开放图生图', () => {
    expect(
      defaultCapabilitySpecFor({
        modality: 'image',
        inputs: 1,
        model: { capability: 'image', operation: 'image_to_image' },
      }),
    ).toEqual({
      version: 1,
      capability: 'image',
      operations: ['image_to_image'],
    });
  });

  it('缺少能力信息时不生成无效规则', () => {
    expect(defaultCapabilitySpecFor(undefined)).toBeNull();
  });
});
