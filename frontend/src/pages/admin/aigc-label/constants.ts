/**
 * AI 标识的静态文案与渲染常量。
 */

import type { AigcLabelPosition } from '../../../types/api';

export const POSITION_LABELS: Record<AigcLabelPosition, string> = {
  'bottom-right': '右下',
  'bottom-left': '左下',
  'top-right': '右上',
  'top-left': '左上',
};

export const POSITION_OPTIONS = Object.keys(POSITION_LABELS) as AigcLabelPosition[];

export const FONT_PRESETS = [
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
  '"Songti SC", "SimSun", serif',
  '"Arial", "Helvetica", sans-serif',
  '"Menlo", "Consolas", monospace',
];

/** 位图渲染倍率：2x，合成时再缩到目标宽度 */
export const RENDER_SCALE = 2;

/**
 * 预览示例底图的装饰色（Canvas 专用，非 UI chrome）。
 *
 * Canvas `fillStyle` 不能读 CSS 变量，色值必须落成字面量；集中在此单点定义，
 * 避免散在绘制逻辑里各改一处。这些颜色只画「示意商品图」，不代表真实产出，
 * 也不参与品牌色体系，故不占用 `global.css` 的语义令牌。
 */
export const PREVIEW_PALETTE = {
  gradientFrom: '#eef2f8',
  gradientTo: '#d9e0ee',
  card: 'rgba(255, 255, 255, 0.55)',
  circle: '#b9c4d8',
  bar: '#9aa8c1',
  caption: 'rgba(23, 26, 43, 0.32)',
  disabled: 'rgba(23, 26, 43, 0.55)',
} as const;
