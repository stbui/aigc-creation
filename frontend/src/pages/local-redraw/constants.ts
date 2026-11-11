import { Circle, Eraser, Hand, Paintbrush, Square } from 'lucide-react';

import type { PaintTool, RegionBounds, ResizeHandle } from '../../mask-sdk';

/**
 * 局部重绘画布页面的常量与类型 —— 目录内文件的唯一常量入口。
 *
 * 矢量标记协议 (画笔/橡皮/框选/圈选)、区域包围盒与画布状态已收进独立
 * SDK（`src/mask-sdk`）；这里只保留页面自己的工具表、区域上限与画布句柄。
 * 目录内新增共享常量时在这里补一行。
 */

export type {
  Mark,
  MaskState,
  PaintTool,
  RegionBounds,
  ResizeHandle,
  ShapeMark,
  ShapeTool,
  StrokeMark,
  StrokeTool,
} from '../../mask-sdk';

/** 页面只有 3 条描述位，遮罩也必须与之一致，不能多圈区域却没有描述。 */
export const MAX_ANNOTATIONS = 3;

export const TOOLS: { value: PaintTool; label: string; shortcut: string; icon: typeof Hand }[] = [
  { value: 'hand', label: '抓手', shortcut: 'H', icon: Hand },
  { value: 'eraser', label: '擦除', shortcut: 'E', icon: Eraser },
  { value: 'rect', label: '框选', shortcut: 'R', icon: Square },
  { value: 'ellipse', label: '圈选', shortcut: 'O', icon: Circle },
  { value: 'brush', label: '涂抹', shortcut: 'B', icon: Paintbrush },
];

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
