import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCapabilities } from '../capabilities';
import { ratioOptions } from '../optionSets';

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
