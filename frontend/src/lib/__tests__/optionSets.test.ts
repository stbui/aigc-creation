import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCapabilities } from '../capabilities';
import { ratioOptions, resolutionOptions } from '../optionSets';

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
});
