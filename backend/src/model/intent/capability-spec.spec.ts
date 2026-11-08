import { describe, expect, it } from 'vitest';

import type { ModelCapabilityConfig } from '../domain/capability-config';
import { capabilitySpecFromModelCapabilityConfig } from './capability-spec';
import { normalizeImageSizeIntent } from './model-intent';

/**
 * 旧版 openai-image 渠道配置只声明了像素编码的 aspectRatio 参数，却没有持久化
 * 比例→像素预设。装载线路合同时必须按协议补齐标准表，否则页面选择 `3:4`
 * 会原样发给只接受 `WIDTHxHEIGHT` 的上游。
 */
function legacyOpenAIImageConfig(): ModelCapabilityConfig {
  return {
    version: 1,
    image: {
      parameters: [
        {
          name: 'size',
          label: '画幅 / 尺寸',
          type: 'string',
          binding: 'aspectRatio',
          encoding: 'pixels',
          pricing: true,
        },
        {
          name: 'imageResolution',
          label: '分辨率',
          type: 'string',
          binding: 'resolution',
          enabled: false,
          pricing: true,
        },
      ],
      references: {
        promptMaxChars: 32000,
        maxImages: 16,
        maxImageBytes: 30 * 1024 * 1024,
        maskSupported: true,
      },
      size: {
        parameter: 'size',
        values: [],
        default: 'auto',
        allowCustom: true,
        presets: [],
      },
      resolution: { supported: false, values: [], default: 'auto' },
      quality: { supported: true, values: ['auto', 'low', 'medium', 'high'], default: 'auto' },
      transparentBackground: { supported: false, default: false },
      responseFormat: { supported: true, default: 'auto' },
      outputFormat: { supported: false },
      maxOutputs: 1,
    },
  };
}

describe('openai-image 旧能力配置兼容', () => {
  it('装载线路合同时补齐标准 1K 像素预设', () => {
    const spec = capabilitySpecFromModelCapabilityConfig(
      legacyOpenAIImageConfig(),
      'image',
      'openai-image',
    );

    const presets = spec.imageSize?.presets ?? [];
    expect(presets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ratio: '1:1', size: '1024x1024', tier: '1k' }),
        expect.objectContaining({ ratio: '3:4', size: '1024x1360', tier: '1k' }),
        expect.objectContaining({ ratio: '4:5', size: '1024x1280', tier: '1k' }),
        expect.objectContaining({ ratio: '9:16', size: '1024x1824', tier: '1k' }),
      ]),
    );
    expect(presets).toHaveLength(10);
    expect(presets.every((preset) => preset.tier === '1k')).toBe(true);
  });

  it('只把已声明的比例映射为像素，不猜测未知比例', () => {
    const spec = capabilitySpecFromModelCapabilityConfig(
      legacyOpenAIImageConfig(),
      'image',
      'openai-image',
    );

    const matched = normalizeImageSizeIntent(spec, {
      capability: 'image',
      options: { size: '3:4', imageResolution: '1k' },
    });
    const unknown = normalizeImageSizeIntent(spec, {
      capability: 'image',
      options: { size: '7:5', imageResolution: '1k' },
    });

    expect(matched.options?.size).toBe('1024x1360');
    expect(unknown.options?.size).toBe('7:5');
  });

  it('非 openai-image 协议不补预设', () => {
    const spec = capabilitySpecFromModelCapabilityConfig(
      legacyOpenAIImageConfig(),
      'image',
      'gemini-image',
    );

    expect(spec.imageSize?.presets ?? []).toEqual([]);
  });
});
