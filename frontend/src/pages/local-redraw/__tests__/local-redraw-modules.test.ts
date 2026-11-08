import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';
import type { Mark, StrokeMark } from '../constants';
import { regionBoundsForMark, strokeHasLength, visibleRegionMarks } from '../utils';

/**
 * 局部重绘页面的具名导入 / 导出对账。
 *
 * 本页除了分层入口, 还有自己的画布组件 `MaskPainter` —— 页面与画布之间的
 * 类型、句柄与工具函数一旦写错名字, 同样只会在浏览器里表现为整页白屏。
 * 这里直接读源码核对每个相对导入的名字。
 *
 * 判据实现与后台 / 其余 C 端目录共用 `src/test/namedImportAudit.ts`。
 */

const ROOTS = [
  'src/pages/local-redraw',
  'src/components',
  'src/hooks',
  'src/lib',
  'src/context',
];

describe('局部重绘页具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const roots = ROOTS.map((root) => resolve(PROJECT_ROOT, root));
    const failures = auditNamedImports(roots);

    expect(failures).toEqual([]);
  });
});

describe('局部重绘区域识别', () => {
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
