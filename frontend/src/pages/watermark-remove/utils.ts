import type { CSSProperties } from 'react';

import type { WatermarkMaskRegion } from './components';
import { ZOOM_MAX, ZOOM_MIN } from './constants';

/**
 * 去除水印页面的纯函数 —— 目录内文件的唯一本页工具来源。
 *
 * 本页的外部依赖 (接口 / 组件 / hook) 分别走 `api.ts` / `components.ts` /
 * `hooks.ts`; 这里只放不依赖 React 的几何与缩放换算。
 */

/**
 * 缩放到界: 按钮、键盘 `+/-` 与滚轮最终都走这里，保证区间一致。
 *
 * @param current 当前缩放 (%)
 * @param delta   增减量 (%)
 */
export function clampZoom(current: number, delta: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + delta));
}

/**
 * 把「在原图上的标注区域」换算成「标注卡缩略图里的裁切框」。
 *
 * 缩略图按 `sourceWidth × sourceHeight` 的比例整体展示原图，区域框以
 * 中心对齐缩放 → 平移，因此 left/top 是从 50% 往回推的半宽半高。
 * `max(…, 1)` 防御宽高为 0 的历史标注，避免除零后整张图飞出容器。
 */
export function previewStyleOf(region: WatermarkMaskRegion): CSSProperties {
  return {
    position: 'absolute',
    left: `${50 - (region.x / Math.max(region.width, 1)) * 100}%`,
    top: `${50 - (region.y / Math.max(region.height, 1)) * 100}%`,
    width: `${(region.sourceWidth / Math.max(region.width, 1)) * 100}%`,
    height: `${(region.sourceHeight / Math.max(region.height, 1)) * 100}%`,
    maxWidth: 'none',
    objectFit: 'fill',
  };
}
