/**
 * 局部重绘页面的纯函数入口 —— 目录内文件的唯一本页工具来源。
 *
 * 画布几何、标记算法与离屏遮罩协议已收进独立 SDK（`src/mask-sdk`）；
 * 本页按目录约定从这里转出，画布组件不直连 `src/mask-sdk`。
 */

export { MaskSession } from '../../mask-sdk';
export {
  MIN_REGION_SIZE,
  clamp,
  cloneMark,
  eraseMaskRegion,
  fillMaskBackground,
  isRegionMark,
  moveRectWithin,
  pointInsideRect,
  regionBoundsForMark,
  resizeRectWithin,
  resolveVisibleMarks,
  sampleStrokeDots,
  sourcePoint,
  strokeHasLength,
  strokePointsHaveLength,
  visibleRegionMarks,
  visibleStrokePoints,
} from '../../mask-sdk';
export type {
  MaskOverlayModel,
  MaskSessionOptions,
  MaskState,
  RegionBounds,
  StrokeMark,
  VisibleMarks,
} from '../../mask-sdk';
