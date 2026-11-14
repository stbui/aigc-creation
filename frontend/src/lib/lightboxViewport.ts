/**
 * 大图查看器的视口几何计算（纯函数，不依赖 React）。
 *
 * 2026-11-15 从 `ImageLightbox` 抽出：缩放 / 拖拽 / 双指 / 旋转四套手势共用的
 * 边界与锚点换算此前散在 730 行组件里，改一处要同时确认另外三处没被带偏。
 * 这里只留数学，状态机在 `hooks/useLightboxViewport`，结构在组件里。
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 0.5;

/** 触屏横向滑动超过这个距离才翻页，避免把轻微抖动当成手势 */
export const SWIPE_THRESHOLD = 56;

export interface Point {
  x: number;
  y: number;
}

export interface PinchStart {
  distance: number;
  midpoint: Point;
  zoom: number;
  offset: Point;
  /** 图片未经 transform 时的中心点，用于把双指锚点换算回图片坐标 */
  layoutCenter: Point;
}

export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpointOf(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

/**
 * 把位移夹在「放大后的图片边缘不越过舞台可视区」的范围内。
 *
 * 旋转 90°/270° 后图片的视觉宽高会互换；如果仍按原布局尺寸计算，
 * 横向拖拽会在竖图上提前停住，纵向则可能拖出空屏。这里按旋转后的
 * 视觉尺寸与舞台内容区取交集，缩放和旋转共用同一套边界。
 */
export function clampOffset(
  next: Point,
  zoom: number,
  img: HTMLImageElement | null,
  rotation = 0,
): Point {
  if (!img) return next;
  const stage = img.parentElement;
  if (!stage) return next;
  const style = getComputedStyle(stage);
  const stageWidth =
    stage.clientWidth -
    (Number.parseFloat(style.paddingLeft) || 0) -
    (Number.parseFloat(style.paddingRight) || 0);
  const stageHeight =
    stage.clientHeight -
    (Number.parseFloat(style.paddingTop) || 0) -
    (Number.parseFloat(style.paddingBottom) || 0);
  const quarterTurn = rotation % 180 !== 0;
  const visualWidth = (quarterTurn ? img.offsetHeight : img.offsetWidth) * zoom;
  const visualHeight = (quarterTurn ? img.offsetWidth : img.offsetHeight) * zoom;
  const limitX = Math.max(0, (visualWidth - stageWidth) / 2);
  const limitY = Math.max(0, (visualHeight - stageHeight) / 2);
  return {
    x: Math.min(limitX, Math.max(-limitX, next.x)),
    y: Math.min(limitY, Math.max(-limitY, next.y)),
  };
}

/**
 * 以光标为锚点缩放时的位移增量。
 *
 * 变换按 `translate(offset) scale(z)`（origin 为图片中心）合成。
 * 取图片**当前**的视觉中心 `c`（已含 offset 与缩放，直接读 rect 即可），
 * 锚点在未缩放图片坐标里的位置是 `p = (anchor - c) / z₀`；要让该点不动，
 * 位移需补 `(z₀ - z₁)·p`。
 *
 * 用图片自身的 rect 而不是舞台 rect：舞台上下内边距不对称（56 / 72），
 * 按舞台中心算会恒定偏 8px，放大时表现为锚点缓慢漂移。
 */
export function anchorDelta(anchor: Point, img: HTMLImageElement, fromZoom: number, toZoom: number): Point {
  const rect = img.getBoundingClientRect();
  const px = (anchor.x - (rect.left + rect.width / 2)) / fromZoom;
  const py = (anchor.y - (rect.top + rect.height / 2)) / fromZoom;
  return { x: (fromZoom - toZoom) * px, y: (fromZoom - toZoom) * py };
}
