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

describe('template 模板参数', () => {
  it('真实模板 id 通过校验', () => {
    expect(() =>
      validateCapabilityParams('template', { templateId: 'longfeng-01', ratio: '3:4', size: '2k' }),
    ).not.toThrow();
  });

  it('缺失或未知模板 id 在扣费前被拒绝', () => {
    expect(() => validateCapabilityParams('template', {})).toThrow('请选择一个有效的写真模板');
    expect(() => validateCapabilityParams('template', { templateId: 'not-exists' })).toThrow(
      '请选择一个有效的写真模板',
    );
  });
});
