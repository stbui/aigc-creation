/**
 * 遮罩画布 SDK 的公共类型。
 *
 * 所有坐标都是**原图像素坐标**：客户端坐标到这里的换算由适配层调用
 * `geometry.sourcePoint` 完成，SDK 内部不接触 DOM 坐标。
 */

/** 画布工具；`hand` 只用于适配层的平移，SDK 不处理。 */
export type PaintTool = 'hand' | 'brush' | 'eraser' | 'rect' | 'ellipse';
export type StrokeTool = 'brush' | 'eraser';
export type ShapeTool = 'rect' | 'ellipse';
/** 能落成标记的工具（不含抓手）。 */
export type DrawTool = StrokeTool | ShapeTool;

export interface Point {
  x: number;
  y: number;
}

/** 原图像素坐标下的矩形。 */
export interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 一笔涂抹；坐标是原图像素。 */
export interface StrokeMark {
  kind: 'stroke';
  id: number;
  tool: StrokeTool;
  points: Point[];
  /** 笔刷宽度（原图像素） */
  width: number;
}

/** 一个框选 / 圈选区域。 */
export interface ShapeMark {
  kind: 'shape';
  id: number;
  tool: ShapeTool;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Mark = StrokeMark | ShapeMark;

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export type DragMode = 'move' | 'resize';

/** 一个可描述区域在原图上的包围盒。 */
export interface RegionBounds extends RectBounds {
  /** 标记的稳定 id；删除 / 重排其它区域时不变。 */
  id: number;
  sourceWidth: number;
  sourceHeight: number;
}

/** 会话对外的状态快照。 */
export interface MaskState {
  /** 遮罩上是否已有可提交的透明区域 */
  painted: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 只包含当前仍有可见遮罩的标注区域 */
  regions: RegionBounds[];
}

export interface SourceSize {
  width: number;
  height: number;
}

export interface MaskSessionOptions {
  /** 最多可描述区域数；默认不限（`Infinity`）。 */
  maxRegions?: number;
  /** 超出上限时的回调；当前草稿会被丢弃。 */
  onRegionLimit?: () => void;
  /** 拖出新形状时是否立即选中（显示缩放柄）；默认 true。 */
  selectDraftShape?: boolean;
}

/**
 * 适配层渲染 DOM 叠层所需的派生数据。
 *
 * 标记在拖动期间是原地变化的，React 的引用比较发现不了；适配层应按
 * 会话的 `version` 记忆化这份结果，做到「一帧一算」。
 */
export interface MaskOverlayModel {
  /** 已提交标记 + 草稿，按绘制顺序。 */
  marks: Mark[];
  /** 标记 id → 从 1 开始的区域编号。 */
  regionIndex: Map<number, number>;
  /** brush 标记 id → 抽稀后的可见圆点。 */
  dotsById: Map<number, Point[]>;
  selectedId: number | null;
}
