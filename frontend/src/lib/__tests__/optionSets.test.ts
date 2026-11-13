import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCapabilities } from '../capabilities';
import { platformDetailSpec, platformSpec, ratioOptions, resolutionOptions } from '../optionSets';

afterEach(() => vi.unstubAllGlobals());

describe('ratioOptions', () => {
  it('按当前能力读取比例，修图系保留「原比例」首项', async () => {
    const ratios = [
      { value: 'original', label: '原比例' },
      { value: '1:1', label: '1:1' },
      { value: '4:3', label: '4:3' },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 0,
            message: '',
            data: {
              groups: [],
              workbenchIds: [],
              items: [
                { id: 'recolor', params: [{ key: 'ratio', options: ratios }] },
                {
                  id: 'main_image',
                  params: [{ key: 'ratio', options: ratios.slice(1) }],
                },
                {
                  id: 'detail_image',
                  params: [{ key: 'ratio', options: ratios.slice(1) }],
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    await loadCapabilities(true);

    expect(ratioOptions('recolor').map((option) => option.value)).toEqual([
      'original',
      '1:1',
      '4:3',
    ]);
    expect(ratioOptions('main_image').map((option) => option.value)).toEqual(['1:1', '4:3']);
    expect(ratioOptions('detail_image').map((option) => option.value)).toEqual(['1:1', '4:3']);
  });
});

describe('platformSpec', () => {
  it('按后端 meta 读取平台主图规格，缺规格时返回 null', async () => {
    const platforms = [
      {
        value: 'taobao',
        label: '淘宝',
        meta: {
          ratio: '1:1',
          size: '1k',
          minPx: 800,
          spec: '主图常规 1:1、边长 ≥800px',
          detail: { size: '1k', widthPx: 750, spec: '详情长图建议宽度 750px' },
        },
      },
      {
        value: 'amazon',
        label: 'Amazon',
        meta: {
          ratio: '1:1',
          size: '2k',
          minPx: 1600,
          spec: '主图常规 1:1、最短边 ≥1600px',
          detail: { size: '2k', widthPx: 1000, spec: '详情图建议宽度 ≥1000px' },
        },
      },
      { value: 'legacy', label: '旧平台' },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 0,
            message: '',
            data: {
              groups: [],
              workbenchIds: [],
              items: [{ id: 'main_image', params: [{ key: 'platform', options: platforms }] }],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    await loadCapabilities(true);

    expect(platformSpec('amazon')).toEqual({
      ratio: '1:1',
      size: '2k',
      minPx: 1600,
      spec: '主图常规 1:1、最短边 ≥1600px',
    });
    expect(platformSpec('legacy')).toBeNull();
    expect(platformSpec(undefined)).toBeNull();
    expect(platformDetailSpec('amazon')).toEqual({
      size: '2k',
      widthPx: 1000,
      spec: '详情图建议宽度 ≥1000px',
    });
    expect(platformDetailSpec('legacy')).toBeNull();
  });
});

describe('resolutionOptions', () => {
  it('多图融合按参考站 1K/2K/4K → 1/2/3 倍计费', async () => {
    const sizes = [
      { value: '1k', label: '1K (1024px)' },
      { value: '2k', label: '2K (2048px)' },
      { value: '4k', label: '4K (4096px)' },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 0,
            message: '',
            data: {
              groups: [],
              workbenchIds: [],
              items: [
                { id: 'main_image', params: [{ key: 'size', options: sizes }] },
                {
                  id: 'multi_fusion',
                  runtime: { remoteAvailable: true },
                  params: [{ key: 'size', options: sizes }],
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    await loadCapabilities(true);

    expect(
      resolutionOptions('multi_fusion').map(({ shortLabel, multiplier, sub, disabled }) => ({
        shortLabel,
        multiplier,
        sub,
        disabled: Boolean(disabled),
      })),
    ).toEqual([
      { shortLabel: '1K', multiplier: 1, sub: '1倍消耗', disabled: false },
      { shortLabel: '2K', multiplier: 2, sub: '2倍消耗', disabled: false },
      { shortLabel: '4K', multiplier: 3, sub: '3倍消耗', disabled: false },
    ]);
  });

  it('其它能力保持基础价 1 倍', async () => {
    const sizes = [{ value: '1k', label: '1K (1024px)' }];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 0,
            message: '',
            data: {
              groups: [],
              workbenchIds: [],
              items: [{ id: 'main_image', params: [{ key: 'size', options: sizes }] }],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    await loadCapabilities(true);

    expect(resolutionOptions('main_image')).toEqual([
      expect.objectContaining({ multiplier: 1, sub: '1倍消耗' }),
    ]);
  });

  it('模型合同声明 imageResolution 时以合同为准，不放开不支持的档位', async () => {
    const sizes = [
      { value: '1k', label: '1K (1024px)' },
      { value: '2k', label: '2K (2048px)' },
      { value: '4k', label: '4K (4096px)' },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 0,
            message: '',
            data: {
              groups: [],
              workbenchIds: [],
              items: [{ id: 'main_image', params: [{ key: 'size', options: sizes }] }],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    await loadCapabilities(true);

    expect(
      resolutionOptions('main_image', ['1k', '2k']).map((option) => Boolean(option.disabled)),
    ).toEqual([false, false, true]);
    expect(
      resolutionOptions('main_image', ['*']).map((option) => Boolean(option.disabled)),
    ).toEqual([false, false, false]);
  });
});
