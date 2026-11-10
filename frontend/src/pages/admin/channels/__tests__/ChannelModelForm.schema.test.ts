import { describe, expect, it } from 'vitest';
import { modelDraftSchema } from '../ChannelModelForm.schema';
import { createDefaultImageCapabilityConfigJson } from '../imageCapability';
import { EMPTY_MODEL_DRAFT } from '../constants';
import { createDefaultTextCapabilityConfigJson } from '../textCapability';

function validDraft() {
  return {
    ...EMPTY_MODEL_DRAFT,
    modelKey: 'seedream-4.0',
    protocol: 'openai.images',
    capabilityConfig: createDefaultImageCapabilityConfigJson([]),
    tiers: [{ ...EMPTY_MODEL_DRAFT.tiers[0], unit: '0.01' }],
  };
}

function issuePaths(input: unknown) {
  return modelDraftSchema.safeParse(input).error?.issues.map((issue) => issue.path.join('.')) ?? [];
}

describe('modelDraftSchema', () => {
  it('必填字段缺失时把错误定位到对应字段', () => {
    const result = modelDraftSchema.safeParse({
      ...validDraft(),
      modelKey: '  ',
      protocol: '',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['modelKey'], message: '请填写商品编号' }),
        expect.objectContaining({ path: ['protocol'], message: '请选择接入方式' }),
      ]),
    );
  });

  it('图片能力合同必须是合法 JSON', () => {
    expect(issuePaths({ ...validDraft(), capabilityConfig: '{oops' })).toContain(
      'capabilityConfig',
    );
  });

  it('图片模型必须包含完整能力参数', () => {
    expect(issuePaths({ ...validDraft(), capabilityConfig: '' })).toContain('capabilityConfig');
  });

  it('文本模型必须包含完整能力参数', () => {
    const result = modelDraftSchema.safeParse({
      ...validDraft(),
      capability: 'text',
      protocol: 'openai.chat',
      capabilityConfig: '',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['capabilityConfig'],
          message: '请配置文本模型能力参数',
        }),
      ]),
    );
  });

  it('默认文本能力合同可以直接保存', () => {
    const result = modelDraftSchema.safeParse({
      ...validDraft(),
      capability: 'text',
      protocol: 'openai.chat',
      capabilityConfig: createDefaultTextCapabilityConfigJson(),
    });

    expect(result.success).toBe(true);
  });

  it('音频能力仍允许留空合同', () => {
    expect(
      modelDraftSchema.safeParse({
        ...validDraft(),
        capability: 'audio',
        capabilityConfig: '',
      }).success,
    ).toBe(true);
  });

  it('拒绝重复标签和非法的价格文本', () => {
    const draft = validDraft();
    expect(
      issuePaths({
        ...draft,
        tags: [
          { text: '官方', color: 'purple' },
          { text: '官方', color: 'blue' },
        ],
        tiers: [{ ...draft.tiers[0], unit: 'abc' }],
      }),
    ).toEqual(expect.arrayContaining(['tags', 'tiers']));
  });

  it('合法草稿可以提交', () => {
    expect(modelDraftSchema.safeParse(validDraft()).success).toBe(true);
  });
});
