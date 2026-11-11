import { describe, expect, it } from 'vitest';
import {
  applyDefaultModelToRequest,
  decodeDefaultModelConfig,
  defaultModelRequest,
  normalizeDefaultModelConfig,
} from './channel-default-model';
import type { ProtocolCatalogEntry, ProtocolCatalogService } from '../protocol/protocol-catalog.service';
import type { ChannelDefaultModelConfig } from './channel.types';

const imageEntry = {
  id: 'openai-image',
  label: 'OpenAI Images',
  capabilities: ['image'],
  imageParameters: [
    {
      name: 'size',
      label: '尺寸',
      type: 'string',
      binding: 'aspectRatio',
      values: ['1024x1024'],
      default: '1024x1024',
    },
    {
      name: 'quality',
      label: '质量',
      type: 'string',
      binding: 'quality',
      values: ['low', 'high'],
      enabled: false,
    },
  ],
} as unknown as ProtocolCatalogEntry;

const textEntry = {
  id: 'openai-chat',
  label: 'OpenAI Chat',
  capabilities: ['text'],
  imageParameters: [],
} as unknown as ProtocolCatalogEntry;

function fakeProtocols(entry: ProtocolCatalogEntry = imageEntry): ProtocolCatalogService {
  return {
    require: () => entry,
  } as unknown as ProtocolCatalogService;
}

function config(overrides: Partial<ChannelDefaultModelConfig> = {}): ChannelDefaultModelConfig {
  return {
    capability: 'image',
    protocol: 'openai-image',
    billingMode: 'fixed_request',
    unitPriceMicrocredits: 2_000_000,
    inputTokenPriceMicrocredits: 0,
    outputTokenPriceMicrocredits: 0,
    cachedTokenPriceMicrocredits: 0,
    enabled: true,
    ...overrides,
  };
}

describe('channel default model config', () => {
  it('库内损坏或空值一律视为未配置', () => {
    expect(decodeDefaultModelConfig('')).toBeNull();
    expect(decodeDefaultModelConfig('{')).toBeNull();
    expect(decodeDefaultModelConfig(JSON.stringify({ capability: 'video', protocol: 'x' }))).toBeNull();
  });

  it('校验提交的类型、协议与计价', () => {
    const normalized = normalizeDefaultModelConfig(
      {
        capability: 'image',
        protocol: 'openai-image',
        billingMode: 'fixed_request',
        unitPriceMicrocredits: 2_000_000,
        enabled: false,
      },
      fakeProtocols(),
    );
    expect(normalized).toMatchObject({
      capability: 'image',
      protocol: 'openai-image',
      unitPriceMicrocredits: 2_000_000,
      enabled: false,
    });

    expect(() =>
      normalizeDefaultModelConfig({ capability: 'video', protocol: 'x' }, fakeProtocols()),
    ).toThrow('仅支持图像或文本');
    expect(() =>
      normalizeDefaultModelConfig({ capability: 'image', protocol: '' }, fakeProtocols()),
    ).toThrow('请选择接入方式');
    expect(() =>
      normalizeDefaultModelConfig(
        {
          capability: 'image',
          protocol: 'openai-image',
          billingMode: 'token',
          outputTokenPriceMicrocredits: 1_000_000,
        },
        fakeProtocols(),
      ),
    ).toThrow('Token 计费仅支持文本和视频模型');
  });

  it('空白类型表示清空默认配置', () => {
    expect(normalizeDefaultModelConfig({ capability: '' }, fakeProtocols())).toBeNull();
    expect(normalizeDefaultModelConfig(null, fakeProtocols())).toBeNull();
  });

  it('按真实上游模型键生成默认能力合同', () => {
    const image = defaultModelRequest(config(), imageEntry, 'gpt-image-2', 'gpt-image-2');
    expect(image.capabilityConfig).toMatchObject({ version: 1 });
    expect((image.capabilityConfig as { image?: unknown }).image).toBeTruthy();

    const text = defaultModelRequest(
      config({ capability: 'text', protocol: 'openai-chat', billingMode: 'fixed_request' }),
      textEntry,
      'gpt-4o-mini',
      'gpt-4o-mini',
    );
    expect(text.capabilityConfig).toMatchObject({
      version: 1,
      text: { contextWindowTokens: 128000 },
    });
  });

  it('只补未填字段，不覆盖表单里显式选择的值', () => {
    const merged = applyDefaultModelToRequest(
      { modelKey: 'm1', capability: '', protocol: '', unitPriceMicrocredits: 3_000_000 },
      config(),
      fakeProtocols(),
    );
    expect(merged.capability).toBe('image');
    expect(merged.protocol).toBe('openai-image');
    expect(merged.unitPriceMicrocredits).toBe(3_000_000);
    expect(merged.enabled).toBe(true);

    // 显式选了另一种能力：默认配置不能硬套
    const untouched = applyDefaultModelToRequest(
      { modelKey: 'm1', capability: 'video', protocol: 'some-video' },
      config(),
      fakeProtocols(),
    );
    expect(untouched.protocol).toBe('some-video');
    expect(untouched.unitPriceMicrocredits).toBeUndefined();
  });

  it('已有价格档时不再注入模型级价格', () => {
    const merged = applyDefaultModelToRequest(
      {
        modelKey: 'm1',
        priceTiers: [{ selector: {}, resolution: '*', billingMode: 'fixed_request', unitPriceMicrocredits: 1 }],
      },
      config(),
      fakeProtocols(),
    );
    expect(merged.unitPriceMicrocredits).toBeUndefined();
    expect(merged.priceTiers).toHaveLength(1);
  });
});
