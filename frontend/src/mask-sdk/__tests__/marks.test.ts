import { describe, expect, it } from 'vitest';

import type { Mark, StrokeMark } from '../types';
import { regionBoundsForMark, strokeHasLength, visibleRegionMarks } from '../marks';

/**
 * 标记识别与包围盒。
 *
 * 这两条判定同时决定「画布上显示什么」和「提交时带哪些区域」：
 * 单点笔迹不能被当成区域，完全擦除的笔迹必须消失，部分擦除后 id 不能变。
 */

const brush = (id: number, points: StrokeMark['points']): StrokeMark => ({
  kind: 'stroke',
  id,
  tool: 'brush',
  points,
  width: 4,
});
const eraser = (points: StrokeMark['points'], width = 40): StrokeMark => ({
  kind: 'stroke',
  id: 99,
  tool: 'eraser',
  points,
  width,
});

describe('局部重绘区域识别', () => {
  it('单点涂抹没有可见长度，不计为区域', () => {
    const mark = brush(1, [{ x: 10, y: 10 }]);
    expect(strokeHasLength(mark)).toBe(false);
    expect(visibleRegionMarks([mark])).toEqual([]);
    expect(regionBoundsForMark(mark, [mark], 100, 100)).toBeNull();
  });

  it('完全擦除的涂抹不计为区域', () => {
    const mark = brush(1, [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
    ]);
    const marks: Mark[] = [mark, eraser([{ x: 10, y: 10 }])];
    expect(visibleRegionMarks(marks)).toEqual([]);
    expect(regionBoundsForMark(mark, marks, 100, 100)).toBeNull();
  });

  it('部分擦除后仍有可见线段时保留原区域 id', () => {
    const mark = brush(7, [
      { x: 10, y: 20 },
      { x: 30, y: 20 },
      { x: 50, y: 20 },
    ]);
    const marks: Mark[] = [mark, eraser([{ x: 10, y: 20 }])];
    expect(visibleRegionMarks(marks).map((item) => item.id)).toEqual([7]);
    expect(regionBoundsForMark(mark, marks, 100, 100)).toMatchObject({ id: 7, x: 28, y: 18 });
  });

  it('删除其它区域后，剩余区域的 id 与包围盒保持稳定', () => {
    const first: Mark = { kind: 'shape', id: 11, tool: 'rect', x: 5, y: 6, width: 20, height: 30 };
    const second: Mark = { kind: 'shape', id: 12, tool: 'ellipse', x: 40, y: 50, width: 25, height: 35 };
    const remaining = visibleRegionMarks([second]);
    expect(remaining.map((item) => item.id)).toEqual([12]);
    expect(regionBoundsForMark(remaining[0], remaining, 100, 100)).toEqual({
      id: 12,
      x: 40,
      y: 50,
      width: 25,
      height: 35,
      sourceWidth: 100,
      sourceHeight: 100,
    });
    expect(regionBoundsForMark(first, [first], 100, 100)?.id).toBe(11);
  });
});
