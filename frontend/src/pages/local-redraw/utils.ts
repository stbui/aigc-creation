import type { Mark, RegionBounds, StrokeMark } from './constants';

/**
 * 局部重绘页面的纯函数 —— 目录内文件的唯一本页工具来源。
 *
 * 本页的外部依赖 (接口 / 组件 / hook) 分别走 `api.ts` / `components.ts` /
 * `hooks.ts`; 这里只放不依赖 React、可被页面与画布共用的几何与标记操作。
 */

/** 只有画笔涂抹和框选/圈选算可描述区域，橡皮只是修正遮罩 */
export function isRegionMark(mark: Mark): boolean {
  return mark.kind === 'shape' || (mark.kind === 'stroke' && mark.tool === 'brush');
}

/** 一笔涂抹至少要产生可见长度，单击产生的零点笔迹不能成为标注区域。 */
export function strokeHasLength(mark: StrokeMark): boolean {
  if (mark.points.length < 2) return false;
  let length = 0;
  for (let i = 1; i < mark.points.length; i += 1) {
    const prev = mark.points[i - 1];
    const current = mark.points[i];
    length += Math.hypot(current.x - prev.x, current.y - prev.y);
  }
  return length >= 1;
}

/** 返回被后续橡皮擦除后仍可见的采样点。 */
export function visibleStrokePoints(mark: StrokeMark, allMarks: Mark[]): StrokeMark['points'] {
  const start = allMarks.indexOf(mark);
  const erasers = allMarks
    .slice(start + 1)
    .filter((item): item is StrokeMark => item.kind === 'stroke' && item.tool === 'eraser');
  if (erasers.length === 0) return mark.points;
  return mark.points.filter(
    (point) =>
      !erasers.some((eraser) =>
        eraser.points.some(
          // 只按橡皮半径判断“被擦掉”；恰好落在边缘的采样点仍保留，
          // 避免粗橡皮把边界点一并吞掉、整段笔迹被误判为完全擦除。
          (erased) => Math.hypot(point.x - erased.x, point.y - erased.y) < eraser.width / 2,
        ),
      ),
  );
}

/** 当前仍可提交 / 编号的区域标记。完全擦除的 brush 不再计入。 */
export function visibleRegionMarks(marks: Mark[]): Mark[] {
  return marks.filter((mark) => {
    if (!isRegionMark(mark)) return false;
    if (mark.kind === 'shape') return mark.width > 0 && mark.height > 0;
    const visible: StrokeMark = { ...mark, points: visibleStrokePoints(mark, marks) };
    return strokeHasLength(visible);
  });
}

/** 单个区域在原图上的包围盒；brush 只按擦除后的可见点计算。 */
export function regionBoundsForMark(
  mark: Mark,
  allMarks: Mark[],
  sourceWidth: number,
  sourceHeight: number,
): RegionBounds | null {
  if (!isRegionMark(mark) || sourceWidth <= 0 || sourceHeight <= 0) return null;
  if (mark.kind === 'shape') {
    if (mark.width <= 0 || mark.height <= 0) return null;
    return {
      id: mark.id,
      x: mark.x,
      y: mark.y,
      width: mark.width,
      height: mark.height,
      sourceWidth,
      sourceHeight,
    };
  }

  const points = visibleStrokePoints(mark, allMarks);
  if (!strokeHasLength({ ...mark, points })) return null;
  const pad = mark.width / 2;
  const minX = Math.max(0, Math.min(...points.map((point) => point.x)) - pad);
  const maxX = Math.min(sourceWidth, Math.max(...points.map((point) => point.x)) + pad);
  const minY = Math.max(0, Math.min(...points.map((point) => point.y)) - pad);
  const maxY = Math.min(sourceHeight, Math.max(...points.map((point) => point.y)) + pad);
  if (maxX <= minX || maxY <= minY) return null;
  return {
    id: mark.id,
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    sourceWidth,
    sourceHeight,
  };
}

/** 数值夹取：拖动和缩放时把标记限制在原图范围内。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 深拷贝标记 —— 拖动开始时的快照必须与实时标记脱钩。 */
export function cloneMark(mark: Mark): Mark {
  return mark.kind === 'stroke'
    ? { ...mark, points: mark.points.map((point) => ({ ...point })) }
    : { ...mark };
}
