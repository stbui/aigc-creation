/**
 * SKU 变体区域编辑器的坐标模型与几何运算（纯函数，不依赖 React）。
 *
 * 2026-11-15 从 `SkuRegionEditorModal` 抽出：区域坐标一律是**归一化值（0~1）**，
 * 与模板图原始像素尺寸无关 —— 换模板图尺寸、导出裁切都靠这个不变量。此前这些
 * 换算散在 671 行组件的顶部，拖动 / 缩放 / 画笔三种交互各自内联一份。
 */

export type SkuRegionType = 'rect' | 'ellipse' | 'brush';

export interface SkuRegionPoint {
  x: number;
  y: number;
}

/** 归一化坐标 (0~1)，与模板图原始像素尺寸无关。 */
export interface SkuRegion {
  id: string;
  type: SkuRegionType;
  x: number;
  y: number;
  width: number;
  height: number;
  points?: SkuRegionPoint[];
}

export type SkuTool = 'hand' | 'rect' | 'ellipse' | 'brush' | 'eraser';
export type SkuHandle = 'nw' | 'ne' | 'sw' | 'se';

export interface Point {
  x: number;
  y: number;
}

export interface Draft {
  type: 'rect' | 'ellipse' | 'brush';
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  points: SkuRegionPoint[];
}

export interface Interaction {
  kind: 'move' | 'resize';
  id: string;
  pointerId: number;
  start: Point;
  original: SkuRegion;
  snapshot: SkuRegion[];
  handle?: SkuHandle;
}

/** 区域最短边（归一化）：低于此值缩放手柄会互相重叠，拖不住。 */
export const MIN_SIZE = 0.025;
/** 撤销栈深度上限：一次框选会话的编辑量远小于此值，超出即丢弃最旧一步。 */
export const MAX_HISTORY = 40;

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 坐标保留 4 位小数：归一化坐标乘上模板边长后仍能对齐像素，同时避免浮点尾巴。 */
export function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function normalizeBox(start: Point, end: Point) {
  const left = clamp01(Math.min(start.x, end.x));
  const top = clamp01(Math.min(start.y, end.y));
  const right = clamp01(Math.max(start.x, end.x));
  const bottom = clamp01(Math.max(start.y, end.y));
  return {
    x: round4(left),
    y: round4(top),
    width: round4(right - left),
    height: round4(bottom - top),
  };
}

/** 画笔笔迹的外接框；空笔迹返回 null（调用方据此丢弃）。 */
export function boundsOfPoints(points: SkuRegionPoint[]) {
  if (points.length === 0) return null;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return normalizeBox({ x: minX, y: minY }, { x: maxX, y: maxY });
}

/** 拖拽四角手柄时的矩形更新；每个方向都夹在 [0,1] 且保留 MIN_SIZE。 */
export function resizeBox(region: SkuRegion, handle: SkuHandle, dx: number, dy: number) {
  let left = region.x;
  let top = region.y;
  let right = region.x + region.width;
  let bottom = region.y + region.height;
  if (handle.includes('w')) left = Math.min(right - MIN_SIZE, Math.max(0, left + dx));
  if (handle.includes('e')) right = Math.max(left + MIN_SIZE, Math.min(1, right + dx));
  if (handle.includes('n')) top = Math.min(bottom - MIN_SIZE, Math.max(0, top + dy));
  if (handle.includes('s')) bottom = Math.max(top + MIN_SIZE, Math.min(1, bottom + dy));
  return {
    ...region,
    x: round4(left),
    y: round4(top),
    width: round4(right - left),
    height: round4(bottom - top),
  };
}

export function createRegionId(): string {
  return `region-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
