import { describe, expect, it } from 'vitest';
import {
  createDefaultImageCapabilityConfig,
  createDefaultImageCapabilityConfigJson,
  normalizeImageCapabilityConfig,
  resolveParameterSettings,
  setImageParameterEnabled,
  setImageParameterValues,
  validateImageCapabilityConfigJson,
  type ImageParameterDefinitionView,
} from '../imageCapability';

const definitions: ImageParameterDefinitionView[] = [
  {
    name: 'size',
    label: '尺寸',
    type: 'string',
    encoding: 'pixels',
    values: ['1024x1024', '1536x1024'],
    default: '1024x1024',
    required: true,
    pricing: true,
  },
  {
    name: 'imageResolution',
    label: '分辨率',
    type: 'string',
    values: ['1k', '2k'],
    default: '2k',
  },
  {
    name: 'quality',
    label: '质量',
    type: 'string',
    values: ['standard', 'high'],
    default: 'high',
  },
  {
    name: 'transparentBackground',
    label: '透明背景',
    type: 'boolean',
    default: true,
  },
  {
    name: 'count',
    label: '输出数量',
    type: 'integer',
    min: 1,
    max: 4,
    values: [1, 2, 4],
    default: 2,
  },
];

function parsedConfig(raw: string) {
  return JSON.parse(raw) as { image: ReturnType<typeof createDefaultImageCapabilityConfig> };
}

describe('imageCapability', () => {
  it('按协议参数生成合法默认合同', () => {
    const config = createDefaultImageCapabilityConfig(definitions, 'seedream-4.0');

    expect(config.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'size', enabled: true }),
        expect.objectContaining({ name: 'count', values: [1, 2, 4] }),
      ]),
    );
    expect(config.size).toMatchObject({
      parameter: 'size',
      values: ['1024x1024', '1536x1024'],
      default: '1024x1024',
    });
    expect(config.resolution).toMatchObject({ supported: true, default: '2k' });
    expect(config.quality).toMatchObject({ supported: true, default: 'high' });
    expect(config.transparentBackground).toEqual({ supported: true, default: true });
    expect(config.maxOutputs).toBe(4);
    expect(validateImageCapabilityConfigJson(createDefaultImageCapabilityConfigJson(definitions))).toBeNull();
  });

  it('修改参数值或启用状态后重新派生合同字段', () => {
    const original = createDefaultImageCapabilityConfig(definitions, 'seedream-4.0');
    const withoutQuality = setImageParameterEnabled(
      original,
      definitions,
      'quality',
      false,
      'seedream-4.0',
    );
    expect(withoutQuality.quality).toEqual({ supported: false, values: [], default: 'auto' });

    const changedQuality = setImageParameterValues(
      original,
      definitions,
      'quality',
      ['high'],
      'seedream-4.0',
    );
    expect(changedQuality.quality).toEqual({
      supported: true,
      values: ['high'],
      default: 'high',
    });

    const disabledCount = setImageParameterEnabled(
      original,
      definitions,
      'count',
      false,
      'seedream-4.0',
    );
    expect(disabledCount.maxOutputs).toBe(1);
  });

  it('必填参数不可关闭，枚举参数不可清空', () => {
    const original = createDefaultImageCapabilityConfig(definitions, 'seedream-4.0');

    expect(
      setImageParameterEnabled(original, definitions, 'size', false, 'seedream-4.0'),
    ).toBe(original);
    expect(
      setImageParameterValues(original, definitions, 'size', [], 'seedream-4.0'),
    ).toBe(original);
    expect(
      setImageParameterValues(original, definitions, 'size', ['1536x1024'], 'seedream-4.0'),
    ).toBe(original);
  });

  it('协议变化时按新参数定义重建编辑项', () => {
    const nextDefinitions: ImageParameterDefinitionView[] = [
      definitions[0],
      { name: 'seed', label: '随机种子', type: 'integer', values: [1, 2, 3], default: 1 },
    ];

    expect(resolveParameterSettings(definitions, undefined, 'seedream-4.0').map((item) => item.name))
      .toContain('imageResolution');
    expect(resolveParameterSettings(nextDefinitions, undefined, 'seedream-4.0').map((item) => item.name))
      .toEqual(['size', 'seed']);
  });

  it('模型范围只保留适用于当前上游的参数', () => {
    const scoped: ImageParameterDefinitionView[] = [
      { name: 'size', label: '尺寸', type: 'string', values: ['1024x1024'] },
      {
        name: 'quality',
        label: '质量',
        type: 'string',
        values: ['high'],
        models: ['seedream-4.0'],
      },
    ];

    expect(resolveParameterSettings(scoped, undefined, 'other-model').map((item) => item.name)).toEqual([
      'size',
    ]);
    expect(
      resolveParameterSettings(scoped, undefined, 'models/seedream-4.0').map((item) => item.name),
    ).toEqual(['size', 'quality']);
  });

  it('拒绝缺失 image、非法范围和缺失尺寸结构', () => {
    expect(validateImageCapabilityConfigJson('{}')).toBe('请配置图片模型能力参数');

    const invalidReference = parsedConfig(createDefaultImageCapabilityConfigJson(definitions));
    invalidReference.image.references.promptMaxChars = 0;
    expect(validateImageCapabilityConfigJson(JSON.stringify(invalidReference))).toBe(
      '提示词最大字符数必须在 1-1000000 之间',
    );

    const missingSize = parsedConfig(createDefaultImageCapabilityConfigJson(definitions));
    delete (missingSize.image as Partial<typeof missingSize.image>).size;
    expect(validateImageCapabilityConfigJson(JSON.stringify(missingSize))).toBe(
      '尺寸参数仅支持不发送、size 或 aspect_ratio',
    );
  });

  it('允许协议参数清单中的开放式尺寸与质量', () => {
    const openDefinitions: ImageParameterDefinitionView[] = [
      {
        name: 'size',
        label: '画幅 / 尺寸',
        type: 'string',
        encoding: 'pixels',
        pricing: true,
      },
      {
        name: 'quality',
        label: '图片质量',
        type: 'string',
        pricing: true,
      },
    ];

    expect(
      validateImageCapabilityConfigJson(
        createDefaultImageCapabilityConfigJson(openDefinitions, 'gpt-image-2.5-flare'),
      ),
    ).toBeNull();
  });

  it('归一化历史合同并保留响应格式等扩展配置', () => {
    const normalized = normalizeImageCapabilityConfig(
      {
        references: { promptMaxChars: 8000 },
        responseFormat: { supported: true, default: 'url' },
      },
      [],
      '',
    );

    expect(normalized.references).toMatchObject({ promptMaxChars: 8000, maxImages: 4 });
    expect(normalized.responseFormat).toEqual({ supported: true, default: 'url' });
  });
});
