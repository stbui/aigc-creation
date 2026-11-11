/**
 * 遮罩画布 SDK —— 独立的、无 React 依赖的画布内核。
 *
 * 使用方式（React 或任意框架 / 原生 JS 均可）：
 *
 * ```ts
 * const session = new MaskSession({ maxRegions: 3 });
 * session.setSourceSize(1024, 768);              // 原图加载完成后
 * const unsubscribe = session.subscribe(render); // 叠层变化（按帧合并）
 * const unsubscribeState = session.onStateChange((state) => {
 *   // painted / canUndo / canRedo / regions
 * });
 *
 * session.beginGesture('brush', point, brushWidth);
 * session.extendGesture(point);
 * session.endGesture();
 * const blob = await session.toBlob();           // 白底 + 透明标注区
 * ```
 *
 * 适配层职责：客户端坐标换算（`sourcePoint`）、DOM 叠层渲染、指针捕获、
 * 平移与缩放。SDK 不接触任何 DOM 结构。
 */

export * from './types';
export {
  MIN_REGION_SIZE,
  clamp,
  eraseMaskRegion,
  fillMaskBackground,
  moveRectWithin,
  pointInsideRect,
  resizeRectWithin,
  sourcePoint,
} from './geometry';
export type { ClientRectLike } from './geometry';
export {
  cloneMark,
  isRegionMark,
  regionBoundsForMark,
  resolveVisibleMarks,
  sampleStrokeDots,
  strokeHasLength,
  strokePointsHaveLength,
  visibleRegionMarks,
  visibleStrokePoints,
} from './marks';
export type { VisibleMarks } from './marks';
export { MaskBuffer, paintMaskMark } from './mask';
export { MaskSession } from './session';
