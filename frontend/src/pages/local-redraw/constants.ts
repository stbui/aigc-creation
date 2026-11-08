import { Circle, Eraser, Hand, Paintbrush, Square } from 'lucide-react';

/**
 * 局部重绘画布页面的常量与类型 —— 目录内文件的唯一常量入口。
 *
 * 矢量标记协议 (画笔/橡皮/框选/圈选) 是页面与遮罩画布的共同事实源:
 * 提交给后端的遮罩、撤回/恢复的重放、标注区域的编号都基于这里的类型。
 * 目录内新增共享常量时在这里补一行。
 */

export type PaintTool = 'hand' | 'brush' | 'eraser' | 'rect' | 'ellipse';

/** 页面只有 3 条描述位，遮罩也必须与之一致，不能多圈区域却没有描述。 */
export const MAX_ANNOTATIONS = 3;

export const TOOLS: { value: PaintTool; label: string; shortcut: string; icon: typeof Hand }[] = [
  { value: 'hand', label: '抓手', shortcut: 'H', icon: Hand },
  { value: 'eraser', label: '擦除', shortcut: 'E', icon: Eraser },
  { value: 'rect', label: '框选', shortcut: 'R', icon: Square },
  { value: 'ellipse', label: '圈选', shortcut: 'O', icon: Circle },
  { value: 'brush', label: '涂抹', shortcut: 'B', icon: Paintbrush },
];

export type StrokeTool = 'brush' | 'eraser';
export type ShapeTool = 'rect' | 'ellipse';

/** 矢量标记：一笔涂抹 / 一个框选区域。坐标均为原图像素坐标。 */
export interface StrokeMark {
  kind: 'stroke';
  id: number;
  tool: StrokeTool;
  points: { x: number; y: number }[];
  /** 笔刷宽度（原图像素） */
  width: number;
}
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

export const RESIZE_HANDLES: ResizeHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
];

/** 一个可描述区域在原图上的包围盒（像素坐标） */
export interface RegionBounds {
  /** 标记的稳定 id；删除/重排其它区域时，这个值不会变化 */
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

/** 画布每次变更后回传给页面的状态。 */
export interface PaintState {
  painted: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 只包含当前仍有可见遮罩的标注区域 */
  regions: RegionBounds[];
}

/** 画布对外的动作 */
export interface MaskPainterHandle {
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  getRegionCount: () => number;
  getRegionBounds: () => RegionBounds[];
  /** 按稳定标记 id 删除区域；不能按下标，完全擦除的隐藏区域会导致错删。 */
  removeRegion: (id: number) => void;
}
