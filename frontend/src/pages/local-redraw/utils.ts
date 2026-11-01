import type { Mark } from './constants';

/**
 * 局部重绘页面的纯函数 —— 目录内文件的唯一本页工具来源。
 *
 * 本页的外部依赖 (接口 / 组件 / hook) 分别走 `api.ts` / `components.ts` /
 * `hooks.ts`; 这里只放不依赖 React、可被页面与画布共用的几何与标记操作。
 */

/** 只有画笔涂抹和框选/圈选算可描述区域，橡皮只是修正遮罩 */
export function isRegionMark(mark: Mark): boolean {
  return mark.kind === 'shape' || (mark.kind === 'stroke' && mark.tool === 'brush');
}

/** 数值夹取：拖动和缩放时把标记限制在原图范围内。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 深拷贝标记 —— 拖动开始时的快照必须与实时标记脱钩。 */
export function cloneMark(mark: Mark): Mark {
  return mark.kind === 'stroke'
    ? { ...mark, points: mark.points.map((point) => ({ ...point })) }
    : { ...mark };
}
