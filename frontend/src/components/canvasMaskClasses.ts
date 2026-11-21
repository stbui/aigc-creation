/**
 * 遮罩标注层的共用皮肤 —— 局部重绘 `MaskPainter` 与去水印 `WatermarkMaskEditor`
 * 渲染同一套 DOM（`.mask-layer > .mask-mark > .mask-mark-index / .resize-handle`），
 * 皮肤只能有一份；放在组件层，谁渲染谁带上，不再依赖某个页面路由的样式表是否已加载。
 */

/** 标注层：与底图严格重合，自身不吃指针事件 */
export const MASK_LAYER = 'pointer-events-none absolute inset-0 z-2';

/** 矩形 / 椭圆 / 画笔标记的公共外观 */
export const MASK_MARK_BASE =
  'absolute box-border cursor-move rounded-full border-2 border-[rgba(128,100,246,0.85)] bg-[rgba(128,100,246,0.28)] pointer-events-auto touch-none -translate-x-1/2 -translate-y-1/2';

export const MASK_MARK_SELECTED = 'z-12 shadow-[0_0_0_1px_rgba(85,70,216,0.35)]';

export const MASK_MARK_BRUSH = 'aspect-square border-0 bg-[var(--surface-brand-3)]';

export const MASK_MARK_INDEX =
  'absolute top-[3px] left-[3px] z-10 grid size-4 place-items-center rounded-full bg-brand text-xs leading-none font-semibold text-card not-italic pointer-events-none';

export const MASK_MARK_INDEX_BRUSH = 'top-0 left-0 -translate-x-1/2 -translate-y-1/2';

/** 笔迹容器：整笔一层，降低每个采样点的透明度 */
export const MASK_BRUSH_STROKE = 'pointer-events-none absolute inset-0 opacity-70';

/** 选中标记的四角 / 四边手柄外观 */
const RESIZE_HANDLE_BASE =
  'absolute z-1 box-border size-2 rounded-[2px] border-2 border-brand bg-card shadow-[0_1px_3px_rgba(31,35,41,0.22)] pointer-events-auto';

/** 手柄位置与光标方向；键与 `ResizeHandle` 同名 */
export const RESIZE_HANDLE: Record<string, string> = {
  n: 'top-0 left-1/2 cursor-ns-resize -translate-x-1/2 -translate-y-1/2',
  e: 'top-1/2 right-0 cursor-ew-resize translate-x-1/2 -translate-y-1/2',
  s: 'bottom-0 left-1/2 cursor-ns-resize -translate-x-1/2 translate-y-1/2',
  w: 'top-1/2 left-0 cursor-ew-resize -translate-x-1/2 -translate-y-1/2',
  nw: 'top-0 left-0 cursor-nwse-resize -translate-x-1/2 -translate-y-1/2',
  ne: 'top-0 right-0 cursor-nesw-resize translate-x-1/2 -translate-y-1/2',
  se: 'right-0 bottom-0 cursor-nwse-resize translate-x-1/2 translate-y-1/2',
  sw: 'bottom-0 left-0 cursor-nesw-resize -translate-x-1/2 translate-y-1/2',
};

/** 拼接手柄完整类名 */
export function resizeHandleClass(handle: string): string {
  return `${RESIZE_HANDLE_BASE} ${RESIZE_HANDLE[handle] ?? ''}`;
}

/** 画笔光标：跟随指针的笔径预览圈 */
export const BRUSH_CURSOR =
  'absolute z-8 aspect-square rounded-full border border-[rgba(85,70,216,0.95)] bg-[rgba(128,100,246,0.18)] pointer-events-none -translate-x-1/2 -translate-y-1/2';
