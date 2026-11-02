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
