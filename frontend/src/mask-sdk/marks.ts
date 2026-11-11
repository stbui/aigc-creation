import type { Mark, Point, RegionBounds, StrokeMark } from './types';

/**
 * 标记的可见性、区域识别与几何派生。
 *
 * 均为纯函数，不依赖 React / DOM。适配层与会话都从这里取，避免
 * 「哪些算可提交区域」「橡皮擦掉了多少」在两处各写一套。
 */

/** 只有画笔涂抹和框选/圈选算可描述区域，橡皮只是修正遮罩。 */
export function isRegionMark(mark: Mark): boolean {
  return mark.kind === 'shape' || (mark.kind === 'stroke' && mark.tool === 'brush');
}

/**
 * 采样点是否构成可见笔迹。
 *
 * 累计长度达到 1 个原图像素即可提前返回 —— 拖动期间这条判定会被反复调用，
 * 没必要每次都把整条折线走完。
 */
export function strokePointsHaveLength(points: StrokeMark['points']): boolean {
  if (points.length < 2) return false;
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const current = points[i];
    length += Math.hypot(current.x - prev.x, current.y - prev.y);
    if (length >= 1) return true;
  }
  return false;
}

/** 一笔涂抹至少要产生可见长度，单击产生的零点笔迹不能成为标注区域。 */
export function strokeHasLength(mark: StrokeMark): boolean {
  return strokePointsHaveLength(mark.points);
}

/** 橡皮是否覆盖某个采样点；只按半径判断，恰好落在边缘的点仍保留。 */
function eraserCovers(eraser: StrokeMark, point: Point): boolean {
  const radius = eraser.width / 2;
  for (const erased of eraser.points) {
    if (Math.hypot(point.x - erased.x, point.y - erased.y) < radius) return true;
  }
  return false;
}

/** 返回被后续橡皮擦除后仍可见的采样点；没有后续橡皮时原样返回（不复制数组）。 */
export function visibleStrokePoints(mark: StrokeMark, allMarks: Mark[]): StrokeMark['points'] {
  const start = allMarks.indexOf(mark);
  const erasers: StrokeMark[] = [];
  for (let i = start + 1; i < allMarks.length; i += 1) {
    const item = allMarks[i];
    if (item.kind === 'stroke' && item.tool === 'eraser') erasers.push(item);
  }
  if (erasers.length === 0) return mark.points;
  return mark.points.filter((point) => !erasers.some((eraser) => eraserCovers(eraser, point)));
}

/** 可见区域与可见笔迹点的推导结果。 */
export interface VisibleMarks {
  /** 当前仍可提交 / 编号的区域标记，保持原始对象引用与顺序。 */
  regions: Mark[];
  /** brush 的可见采样点；完全擦除的笔迹不在这里。 */
  pointsById: Map<number, StrokeMark['points']>;
}

/**
 * 一次遍历得到可见区域与可见笔迹点。
 *
 * 画布既要给区域编号，又要渲染笔迹点；分两次算会把橡皮过滤重复做两遍。
 * 笔迹长、橡皮多时这是每帧的实打实开销，这里合并成一次。
 */
export function resolveVisibleMarks(marks: Mark[]): VisibleMarks {
  const regions: Mark[] = [];
  const pointsById = new Map<number, StrokeMark['points']>();
  for (const mark of marks) {
    if (mark.kind === 'shape') {
      if (mark.width > 0 && mark.height > 0) regions.push(mark);
      continue;
    }
    if (mark.tool === 'eraser') continue;
    const points = visibleStrokePoints(mark, marks);
    if (!strokePointsHaveLength(points)) continue;
    pointsById.set(mark.id, points);
    regions.push(mark);
  }
  return { regions, pointsById };
}

/** 当前仍可提交 / 编号的区域标记。完全擦除的 brush 不再计入。 */
export function visibleRegionMarks(marks: Mark[]): Mark[] {
  return resolveVisibleMarks(marks).regions;
}

/**
 * 把可见笔迹点抽稀成 DOM 圆点。
 *
 * 圆形笔刷的轮廓由「圆心间距 ≤ 半径」决定：采样再密也只是重复覆盖，
 * 却会让 DOM 叠层每次重建整条笔迹的节点。按半个笔宽抽稀，既保持视觉
 * 连续，又把节点数压到与笔迹长度成正比的下限。
 */
export function sampleStrokeDots(points: StrokeMark['points'], width: number): StrokeMark['points'] {
  if (points.length <= 2) return points;
  const minGap = Math.max(width / 2, 1);
  const dots: StrokeMark['points'] = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    if (Math.hypot(point.x - last.x, point.y - last.y) >= minGap) {
      dots.push(point);
      last = point;
    }
  }
  const tail = points[points.length - 1];
  if (dots[dots.length - 1] !== tail) dots.push(tail);
  return dots;
}

/**
 * 单个区域在原图上的包围盒。
 *
 * `visiblePoints` 可由 `resolveVisibleMarks` 一并给出，避免重复做橡皮过滤；
 * 不传时按 `allMarks` 现算，保持独立可用性。
 */
export function regionBoundsForMark(
  mark: Mark,
  allMarks: Mark[],
  sourceWidth: number,
  sourceHeight: number,
  visiblePoints?: StrokeMark['points'],
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

  const points = visiblePoints ?? visibleStrokePoints(mark, allMarks);
  if (!strokePointsHaveLength(points)) return null;

  /* 单次遍历取极值：长笔迹用 Math.min(...points) 展开既慢又有参数上限风险。 */
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  const pad = mark.width / 2;
  minX = Math.max(0, minX - pad);
  maxX = Math.min(sourceWidth, maxX + pad);
  minY = Math.max(0, minY - pad);
  maxY = Math.min(sourceHeight, maxY + pad);
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

/** 深拷贝标记 —— 拖动开始时的快照必须与实时标记脱钩。 */
export function cloneMark(mark: Mark): Mark {
  return mark.kind === 'stroke'
    ? { ...mark, points: mark.points.map((point) => ({ ...point })) }
    : { ...mark };
}
