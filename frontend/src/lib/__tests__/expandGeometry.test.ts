import { describe, expect, it } from 'vitest';
import { computeExpandPlacement, getExpandCanvasAspect } from '../expandGeometry';

/**
 * 智能扩图 placement 几何。
 *
 * 这段计算曾被「按 occupy/100 直接当占比」的写法替换过，结果在源图与目标
 * 画幅比例不同时把原图拉变形。这里锁住的是**归一化后的实际落位**，不是
 * 某个中间值，改公式必须同步改预期。
 */
describe('computeExpandPlacement', () => {
  it('原比例沿用源图画幅：占比同时作用于宽高并居中', () => {
    expect(computeExpandPlacement(800, 600, 'original', 50, 'center')).toEqual({
      placementX: 0.25,
      placementY: 0.25,
      placementWidth: 0.5,
      placementHeight: 0.5,
    });
  });

  it('原比例预览使用源图宽高比，固定比例使用目标画布', () => {
    expect(getExpandCanvasAspect('original', 800, 600)).toBe('800 / 600');
    expect(getExpandCanvasAspect('original')).toBe('1 / 1');
    expect(getExpandCanvasAspect('4:3')).toBe('1152 / 864');
    expect(getExpandCanvasAspect('9:16')).toBe('720 / 1280');
  });

  it('1:1 画布容纳宽图：限高后上下留白', () => {
    expect(computeExpandPlacement(800, 400, '1:1', 100, 'center')).toEqual({
      placementX: 0,
      placementY: 0.25,
      placementWidth: 1,
      placementHeight: 0.5,
    });
  });

  it('9:16 画布 + 右上：宽高分别按画布归一化', () => {
    expect(computeExpandPlacement(800, 600, '9:16', 100, 'top-right')).toEqual({
      placementX: 0,
      placementY: 0,
      placementWidth: 1,
      placementHeight: 0.421875,
    });
  });

  it('16:9 画布 + 右下：横向留白由右对齐决定', () => {
    expect(computeExpandPlacement(800, 600, '16:9', 100, 'bottom-right')).toEqual({
      placementX: 0.25,
      placementY: 0,
      placementWidth: 0.75,
      placementHeight: 1,
    });
  });

  it('occupy 低于下限时按 1% 处理，不产生 0 尺寸', () => {
    const p = computeExpandPlacement(100, 100, 'original', 0, 'center');
    expect(p).toEqual({
      placementX: 0.495,
      placementY: 0.495,
      placementWidth: 0.01,
      placementHeight: 0.01,
    });
  });

  it('occupy 高于上限时按 100% 处理', () => {
    expect(computeExpandPlacement(100, 100, 'original', 500, 'center')).toEqual({
      placementX: 0,
      placementY: 0,
      placementWidth: 1,
      placementHeight: 1,
    });
  });

  it('未内置的比例按 W:H 解析画布，不落到兜底 1:1', () => {
    expect(computeExpandPlacement(10, 8, '5:4', 50, 'center')).toEqual({
      placementX: 0.25,
      placementY: 0.25,
      placementWidth: 0.5,
      placementHeight: 0.5,
    });
  });

  it('非法比例回落到兜底画布，结果仍是有限数', () => {
    const p = computeExpandPlacement(100, 50, 'abc', 100, 'center');
    expect(p).toEqual({
      placementX: 0,
      placementY: 0.25,
      placementWidth: 1,
      placementHeight: 0.5,
    });
  });

  it('源图尺寸为 0 时夹到 1px，不出现 Infinity / NaN', () => {
    const p = computeExpandPlacement(0, 0, '1:1', 100, 'center');
    expect(p).toEqual({ placementX: 0, placementY: 0, placementWidth: 1, placementHeight: 1 });
  });

  it('九宫格位置都落在画布内', () => {
    const positions = [
      'top-left',
      'top',
      'top-right',
      'left',
      'center',
      'right',
      'bottom-left',
      'bottom',
      'bottom-right',
    ];
    for (const position of positions) {
      const p = computeExpandPlacement(800, 600, '3:4', 80, position);
      expect(p.placementX).toBeGreaterThanOrEqual(0);
      expect(p.placementY).toBeGreaterThanOrEqual(0);
      expect(p.placementX + p.placementWidth).toBeLessThanOrEqual(1.000001);
      expect(p.placementY + p.placementHeight).toBeLessThanOrEqual(1.000001);
    }
  });
});
