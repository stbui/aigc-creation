import { describe, expect, it } from 'vitest';

import { sanitizeParams, validateCapabilityParams } from './capability.registry';

describe('main_image 批次参数', () => {
  it('参数清洗保留批次技术字段', () => {
    const params = sanitizeParams('main_image', {
      productName: '测试商品',
      description: '测试描述',
      variant: 'scene',
      batchId: 'batch-regression',
      batchIndex: 2,
      batchSize: 4,
    });

    expect(params).toMatchObject({
      batchId: 'batch-regression',
      batchIndex: 2,
      batchSize: 4,
    });
  });

  it('批次技术字段通过提交前校验', () => {
    expect(() =>
      validateCapabilityParams('main_image', {
        productName: '测试商品',
        description: '测试描述',
        variant: 'scene',
        batchId: 'batch-regression',
        batchIndex: 2,
        batchSize: 4,
      }),
    ).not.toThrow();
  });
});
