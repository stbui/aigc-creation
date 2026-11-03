import { describe, expect, it } from 'vitest';

import { splitCloneInputs } from '../utils';

describe('splitCloneInputs', () => {
  it('空输入返回空商品图与空参考图', () => {
    expect(splitCloneInputs(undefined)).toEqual({ productUrls: [], referenceUrl: null });
    expect(splitCloneInputs([])).toEqual({ productUrls: [], referenceUrl: null });
  });

  it('只有一张图时按商品图展示，不误判为参考图', () => {
    expect(splitCloneInputs(['product.png'])).toEqual({
      productUrls: ['product.png'],
      referenceUrl: null,
    });
  });

  it('两张图时拆为一张商品图和一张参考图', () => {
    expect(splitCloneInputs(['product.png', 'reference.png'])).toEqual({
      productUrls: ['product.png'],
      referenceUrl: 'reference.png',
    });
  });

  it('多张商品图时保留全部商品图顺序，末位作为参考图', () => {
    expect(
      splitCloneInputs([
        'product-1.png',
        'product-2.png',
        'product-3.png',
        'product-4.png',
        'product-5.png',
        'reference.png',
      ]),
    ).toEqual({
      productUrls: ['product-1.png', 'product-2.png', 'product-3.png', 'product-4.png', 'product-5.png'],
      referenceUrl: 'reference.png',
    });
  });
});
