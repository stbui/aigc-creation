import type { RectBounds } from './types';

/**
 * 遮罩画布的共享几何与离屏遮罩绘制原语。
 *
 * 局部重绘与去水印共用同一套坐标换算、矩形拖动 / 缩放与「白底 = 保留、
 * 透明 = 要重绘 / 去除」的遮罩协议。两份实现曾各写一套边界夹取：坐标换算、
 * 最小边长、缩放时对边的限制一旦漂移，遮罩位置就会和用户框选的位置对不上，
 * 而单测与类型检查都发现不了。协议与几何只在这里定义。
 */

/** 画框的客户端矩形（`DOMRect` 结构兼容，便于直接传入）。 */
export interface ClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

/** 标注区域的最小边长（原图像素）；更小的框视为误触。 */
export const MIN_REGION_SIZE = 4;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 客户端坐标 → 原图像素坐标。
 *
 * 结果夹在 `[0, 源图宽高]` 内：拖到画框外时坐标停在边缘，而不是变成负值。
 * 画框或原图尺寸无效时返回 null —— 此时任何换算都没有意义，调用方必须
 * 自己决定退回值，不能拿 0 当合法坐标继续画。
 */
export function sourcePoint(
  clientX: number,
  clientY: number,
  rect: ClientRectLike | null,
  sourceWidth: number,
  sourceHeight: number,
): { x: number; y: number } | null {
  if (!rect || rect.width <= 0 || rect.height <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }
  return {
    x: clamp(((clientX - rect.left) / rect.width) * sourceWidth, 0, sourceWidth),
    y: clamp(((clientY - rect.top) / rect.height) * sourceHeight, 0, sourceHeight),
  };
}

/** 指针是否落在画框内；用于「按下即新建」时避免从画框外起框。 */
export function pointInsideRect(
  rect: ClientRectLike,
  clientX: number,
  clientY: number,
): boolean {
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

/** 拖动矩形：尺寸不变，整体夹在源图范围内。 */
export function moveRectWithin(
  snapshot: RectBounds,
  dx: number,
  dy: number,
  sourceWidth: number,
  sourceHeight: number,
): RectBounds {
  return {
    x: clamp(snapshot.x + dx, 0, Math.max(0, sourceWidth - snapshot.width)),
    y: clamp(snapshot.y + dy, 0, Math.max(0, sourceHeight - snapshot.height)),
    width: snapshot.width,
    height: snapshot.height,
  };
}

/**
 * 缩放矩形。
 *
 * `handle` 是方向串，四边（`n` / `e` / `s` / `w`）与四角（`ne` / `sw` …）
 * 共用一份实现：命中的边跟着指针走，对边保持不动，且不允许短于
 * `MIN_REGION_SIZE`。
 */
export function resizeRectWithin(
  snapshot: RectBounds,
  handle: string | undefined,
  dx: number,
  dy: number,
  sourceWidth: number,
  sourceHeight: number,
  minSize = MIN_REGION_SIZE,
): RectBounds {
  let left = snapshot.x;
  let top = snapshot.y;
  let right = snapshot.x + snapshot.width;
  let bottom = snapshot.y + snapshot.height;
  if (handle?.includes('w')) left = clamp(left + dx, 0, right - minSize);
  if (handle?.includes('e')) right = clamp(right + dx, left + minSize, sourceWidth);
  if (handle?.includes('n')) top = clamp(top + dy, 0, bottom - minSize);
  if (handle?.includes('s')) bottom = clamp(bottom + dy, top + minSize, sourceHeight);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * 遮罩底色。
 *
 * 白色 = 保留，透明 = 交给模型重绘 / 去除 —— 与 OpenAI `images/edits`
 * 的 mask 约定一致，后端按同一语义消费。任何导出遮罩都必须从这里起底。
 */
export function fillMaskBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);
}

/** 在遮罩上挖出透明区域（destination-out）。 */
export function eraseMaskRegion(
  ctx: CanvasRenderingContext2D,
  shape: 'rect' | 'ellipse',
  bounds: RectBounds,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'black';
  if (shape === 'rect') {
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.ellipse(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
    Math.abs(bounds.width) / 2,
    Math.abs(bounds.height) / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}
